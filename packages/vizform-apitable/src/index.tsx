import React, { useEffect, useMemo, useRef } from 'react'
import {
  initializeWidget,
  useActiveViewId,
  useRecords,
  useFields,
  useDatasheet,
  useSettingsButton,
  useCloudStorage,
  useExpandRecord,
  useViewMeta,
  FieldType,
} from '@apitable/widget-sdk'
import { colorFor } from '@winstonfassett/vizform-core'
import {
  MdBarChartLC,
  MdPieChartLC,
  MdConcentricArcLC,
  MdTreemapLC,
  MdIcicleLC,
  MdSunburstLC,
  group,
  leaf,
  type BiNode,
} from '@winstonfassett/vizform-charts'

// Register custom elements once
const TAGS: Array<[string, CustomElementConstructor]> = [
  ['v-apitable-bar', MdBarChartLC as unknown as CustomElementConstructor],
  ['v-apitable-pie', MdPieChartLC as unknown as CustomElementConstructor],
  ['v-apitable-arc', MdConcentricArcLC as unknown as CustomElementConstructor],
  ['v-apitable-treemap', MdTreemapLC as unknown as CustomElementConstructor],
  ['v-apitable-icicle', MdIcicleLC as unknown as CustomElementConstructor],
  ['v-apitable-sunburst', MdSunburstLC as unknown as CustomElementConstructor],
]
for (const [tag, cls] of TAGS) {
  if (!customElements.get(tag)) customElements.define(tag, cls)
}

const NUMERIC_TYPES = new Set<string>([
  FieldType.Number,
  FieldType.Currency,
  FieldType.Percent,
  FieldType.Rating,
])

type FlatMode = 'treemap' | 'bands' | 'pie' | 'arc'
type HierMode = 'h-treemap' | 'h-icicle' | 'h-sunburst'
type ViewMode = FlatMode | HierMode

const FLAT_MODES: FlatMode[] = ['treemap', 'bands', 'pie', 'arc']
const HIER_MODES: HierMode[] = ['h-treemap', 'h-icicle', 'h-sunburst']
const HIER_LABELS: Record<HierMode, string> = {
  'h-treemap': 'tree',
  'h-icicle': 'icicle',
  'h-sunburst': 'sunburst',
}
const FLAT_TAG: Record<FlatMode, string> = {
  treemap: 'v-apitable-treemap',
  bands: 'v-apitable-bar',
  pie: 'v-apitable-pie',
  arc: 'v-apitable-arc',
}
const HIER_TAG: Record<HierMode, string> = {
  'h-treemap': 'v-apitable-treemap',
  'h-icicle': 'v-apitable-icicle',
  'h-sunburst': 'v-apitable-sunburst',
}

interface FlatDatum { id: string; label: string; value: number }

function buildHierRoot(
  records: ReturnType<typeof useRecords>,
  groupFieldIds: string[],
  valueFieldId: string,
): BiNode {
  function bucket(rec: (typeof records)[0], fieldId: string): string {
    const v = rec.getCellValueString(fieldId)
    return v != null && v !== '' ? v : '(empty)'
  }

  function buildLevel(recs: typeof records, depth: number): BiNode[] {
    if (depth >= groupFieldIds.length) {
      return recs.map((r) =>
        leaf(
          r.title ?? r.id,
          Number(r.getCellValue(valueFieldId)) || 0,
          colorFor(r.title ?? r.id),
        ),
      )
    }
    const fid = groupFieldIds[depth]
    const groups = new Map<string, typeof records>()
    for (const rec of recs) {
      const key = bucket(rec, fid)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(rec)
    }
    return Array.from(groups.entries()).map(([key, groupRecs]) =>
      group(key, colorFor(key), buildLevel(groupRecs, depth + 1)),
    )
  }

  const children = buildLevel(records, 0)
  return group('All', 'oklch(0.28 0 0)', children)
}

interface ChartMountProps {
  mode: ViewMode
  flatData: FlatDatum[]
  hierRoot: BiNode
}

function ChartMount({ mode, flatData, hierRoot }: ChartMountProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const isHier = (HIER_MODES as string[]).includes(mode)
    const tag = isHier ? HIER_TAG[mode as HierMode] : FLAT_TAG[mode as FlatMode]
    const el = document.createElement(tag) as HTMLElement & {
      externalData?: unknown
      externalRoot?: BiNode
    }
    el.setAttribute('no-source', '')
    el.style.width = '100%'
    el.style.height = '100%'
    if (isHier) {
      el.externalRoot = hierRoot
    } else if (mode === 'bands') {
      ;(el as any).orientation = 'horizontal'
      ;(el as any).colorMode = 'palette'
      ;(el as any).labelMode = 'inside'
      ;(el as any).valueMode = 'inside'
      el.externalData = flatData.map((d) => ({ label: d.label, value: d.value }))
    } else if (mode === 'pie') {
      el.externalData = flatData.map((d) => ({ id: d.id, label: d.label, value: d.value }))
    } else if (mode === 'arc') {
      el.externalData = flatData.map((d) => ({ label: d.label, value: Math.min(100, d.value) }))
    } else {
      // flat treemap: wrap as a single-level hier root
      el.externalRoot = group(
        'All',
        'oklch(0.28 0 0)',
        flatData.map((d) => leaf(d.label, d.value, colorFor(d.label))),
      )
    }
    container.appendChild(el)
    return () => {
      if (container.contains(el)) container.removeChild(el)
    }
  }, [mode, flatData, hierRoot])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

function AllocVizWidget() {
  const [isShowingSettings, toggleSettings] = useSettingsButton()
  const [vizMode, setVizMode] = useCloudStorage<ViewMode>('vizMode', 'treemap')
  const [activeFieldId, setActiveFieldId, canEditSettings] = useCloudStorage<string>('activeFieldId', '')

  const viewId = useActiveViewId()
  const records = useRecords(viewId)
  const fields = useFields(viewId)
  const datasheet = useDatasheet()
  const expandRecord = useExpandRecord()
  const viewMeta = useViewMeta(viewId)

  const groupInfo = viewMeta?.groupInfo ?? []
  const hasGroups = groupInfo.length > 0

  const numericFields = useMemo(
    () => fields.filter((f) => NUMERIC_TYPES.has(f.type as string)),
    [fields],
  )

  const resolvedFieldId =
    numericFields.find((f) => f.id === activeFieldId)?.id ?? numericFields[0]?.id ?? ''
  const activeField = fields.find((f) => f.id === resolvedFieldId)
  const activeUnit = activeField?.name ?? 'value'

  const fieldNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of fields) m[f.id] = f.name
    return m
  }, [fields])

  const flatData = useMemo<FlatDatum[]>(() => {
    if (!resolvedFieldId) return []
    return records.map((r) => ({
      id: r.id,
      label: r.title ?? r.id,
      value: Number(r.getCellValue(resolvedFieldId)) || 0,
    }))
  }, [records, resolvedFieldId])

  const hierRoot = useMemo<BiNode>(() => {
    if (!resolvedFieldId) return group('All', 'oklch(0.28 0 0)', [])
    if (hasGroups) {
      return buildHierRoot(records, groupInfo.map((g) => g.fieldId), resolvedFieldId)
    }
    return group(
      'All',
      'oklch(0.28 0 0)',
      records.map((r) =>
        leaf(
          r.title ?? r.id,
          Number(r.getCellValue(resolvedFieldId)) || 0,
          colorFor(r.title ?? r.id),
        ),
      ),
    )
  }, [records, groupInfo, resolvedFieldId, hasGroups])

  const isHierMode = (HIER_MODES as string[]).includes(vizMode)

  const btnBase: React.CSSProperties = {
    padding: '2px 10px', borderRadius: 4, border: '1px solid #444',
    background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 11,
  }
  const btnActive: React.CSSProperties = { ...btnBase, background: '#444', color: '#fff' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111', color: '#ccc' }}>

      {/* Mode strip */}
      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
        {FLAT_MODES.map((m) => (
          <button key={m} style={vizMode === m ? btnActive : btnBase} onClick={() => setVizMode(m)}>
            {m}
          </button>
        ))}
        <span style={{ color: '#444', fontSize: 11 }}>|</span>
        {HIER_MODES.map((m) => (
          <button key={m} style={vizMode === m ? btnActive : btnBase} onClick={() => setVizMode(m)}>
            {HIER_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Settings panel */}
      {isShowingSettings && numericFields.length > 0 && (
        <div style={{ padding: '8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, fontSize: 12 }}>
          <div style={{ marginBottom: 4, color: '#888' }}>Size field</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {numericFields.map((f) => (
              <button key={f.id} disabled={!canEditSettings}
                style={f.id === resolvedFieldId ? btnActive : btnBase}
                onClick={() => setActiveFieldId(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          {hasGroups && (
            <div style={{ marginTop: 6, color: '#666', fontSize: 11 }}>
              Grouped by: {groupInfo.map((g) => fieldNameById[g.fieldId] ?? g.fieldId).join(' › ')}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {numericFields.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
          Add a Number, Currency, Percent, or Rating field to visualize
        </div>
      )}

      {/* Viz */}
      {numericFields.length > 0 && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ChartMount
            mode={vizMode}
            flatData={flatData}
            hierRoot={hierRoot}
          />
        </div>
      )}
    </div>
  )
}

initializeWidget(AllocVizWidget, process.env.WIDGET_PACKAGE_ID)
