import React, { useMemo } from 'react'
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
import { Viz, HViz, pickColor } from '@winstonfassett/vizform-react'
import type { Goal, GoalTree, ViewMode } from '@winstonfassett/vizform-react'

const NUMERIC_TYPES = new Set<string>([
  FieldType.Number,
  FieldType.Currency,
  FieldType.Percent,
  FieldType.Rating,
])

const FLAT_MODES: ViewMode[] = ['treemap', 'radial', 'bands']
const HIER_MODES: ViewMode[] = ['h-treemap', 'h-icicle', 'h-radial']
const HIER_LABELS: Record<string, string> = { 'h-treemap': 'tree', 'h-icicle': 'icicle', 'h-radial': 'sunburst' }

// Build a hierarchical GoalTree from records + multi-level group fields.
function buildGroupedTree(
  records: ReturnType<typeof useRecords>,
  groupFieldIds: string[],
  valueFieldId: string,
  activeUnit: string,
  getFieldName: (id: string) => string,
): GoalTree {
  // get string value of a group field for a record (for bucketing)
  function bucket(rec: (typeof records)[0], fieldId: string): string {
    const v = rec.getCellValueString(fieldId)
    return v != null && v !== '' ? v : '(empty)'
  }

  function buildLevel(recs: typeof records, depth: number, parentColor: string): GoalTree[] {
    if (depth >= groupFieldIds.length) {
      return recs.map((r, i) => ({
        id: r.id,
        name: r.title ?? r.id,
        color: pickColor(i),
        value: Number(r.getCellValue(valueFieldId)) || 0,
      }))
    }
    const fid = groupFieldIds[depth]
    const groups = new Map<string, typeof records>()
    for (const rec of recs) {
      const key = bucket(rec, fid)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(rec)
    }
    return Array.from(groups.entries()).map(([key, groupRecs], i) => {
      const color = pickColor(i * 7 + depth * 3)
      return {
        id: `__grp__d${depth}__${key}`,
        name: key,
        color,
        value: 0,
        children: buildLevel(groupRecs, depth + 1, color),
      }
    })
  }

  const children = buildLevel(records, 0, '#888')
  return { id: '__root__', name: 'All', color: 'oklch(0.28 0 0)', value: 0, children }
}

function AllocVizWidget() {
  const [isShowingSettings, toggleSettings] = useSettingsButton()
  const [vizMode, setVizMode] = useCloudStorage<ViewMode>('vizMode', 'treemap')
  const [activeFieldId, setActiveFieldId, canEditSettings] = useCloudStorage<string>('activeFieldId', '')
  const [sortMode, setSortMode] = useCloudStorage<'index' | 'size'>('sortMode', 'index')

  const viewId = useActiveViewId()
  const records = useRecords(viewId)
  const fields = useFields(viewId)
  const datasheet = useDatasheet()
  const expandRecord = useExpandRecord()
  const viewMeta = useViewMeta(viewId)

  const groupInfo = viewMeta?.groupInfo ?? []
  const hasGroups = groupInfo.length > 0

  const numericFields = useMemo(
    () => fields.filter(f => NUMERIC_TYPES.has(f.type as string)),
    [fields]
  )

  const resolvedFieldId =
    numericFields.find(f => f.id === activeFieldId)?.id ?? numericFields[0]?.id ?? ''
  const activeField = fields.find(f => f.id === resolvedFieldId)
  const activeUnit = activeField?.name ?? 'value'

  const fieldIdByName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of fields) m[f.name] = f.id
    return m
  }, [fields])

  const fieldNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of fields) m[f.id] = f.name
    return m
  }, [fields])

  const goals = useMemo<Goal[]>(() =>
    records.map((record, idx) => ({
      id: record.id,
      name: record.title ?? record.id,
      color: pickColor(idx),
      measurements: {
        [activeUnit]: Number(record.getCellValue(resolvedFieldId)) || 0,
        _index: idx,
      },
      archived: false,
      tags: [],
      urgent: false,
      important: false,
      createdAt: '',
      updatedAt: '',
    })),
    [records, resolvedFieldId, activeUnit]
  )

  const groupedTree = useMemo<GoalTree>(() => {
    if (!resolvedFieldId) return { id: '__root__', name: 'All', color: 'oklch(0.28 0 0)', value: 0, children: [] }
    if (hasGroups) {
      const groupFieldIds = groupInfo.map(g => g.fieldId)
      return buildGroupedTree(records, groupFieldIds, resolvedFieldId, activeUnit, id => fieldNameById[id] ?? id)
    }
    // Flat: wrap all records in a single-level tree
    return {
      id: '__root__', name: 'All', color: 'oklch(0.28 0 0)', value: 0,
      children: records.map((r, i) => ({
        id: r.id,
        name: r.title ?? r.id,
        color: pickColor(i),
        value: Number(r.getCellValue(resolvedFieldId)) || 0,
      })),
    }
  }, [records, groupInfo, resolvedFieldId, activeUnit, hasGroups, fieldNameById])

  const isHierMode = (HIER_MODES as string[]).includes(vizMode)
  const effectiveMode: ViewMode = vizMode

  const handleUpdate = (id: string, patch: Partial<Goal>) => {
    if (!patch.measurements || !datasheet) return
    const updates: Record<string, unknown> = {}
    for (const [unitName, val] of Object.entries(patch.measurements)) {
      const fid = fieldIdByName[unitName]
      if (fid) updates[fid] = val
    }
    if (Object.keys(updates).length) datasheet.setRecord(id, updates as never)
  }

  const handleGoalClick = (goal: Goal) => expandRecord({ recordIds: [goal.id] })
  const handleLeafClick = (id: string) => expandRecord({ recordIds: [id] })

  const btnBase: React.CSSProperties = {
    padding: '2px 10px', borderRadius: 4, border: '1px solid #444',
    background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 11,
  }
  const btnActive: React.CSSProperties = { ...btnBase, background: '#444', color: '#fff' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111', color: '#ccc' }}>

      {/* Mode strip */}
      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
        {FLAT_MODES.map(m => (
          <button key={m} style={effectiveMode === m ? btnActive : btnBase} onClick={() => setVizMode(m)}>
            {m}
          </button>
        ))}
        <span style={{ color: '#444', fontSize: 11 }}>|</span>
        {HIER_MODES.map(m => (
          <button key={m} style={effectiveMode === m ? btnActive : btnBase} onClick={() => setVizMode(m)}>
            {HIER_LABELS[m]}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button style={sortMode === 'index' ? btnActive : btnBase} onClick={() => setSortMode('index')} title="Sort by view order">idx</button>
          <button style={sortMode === 'size' ? btnActive : btnBase} onClick={() => setSortMode('size')} title="Sort by value">↓val</button>
        </div>
      </div>

      {/* Settings panel */}
      {isShowingSettings && numericFields.length > 0 && (
        <div style={{ padding: '8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, fontSize: 12 }}>
          <div style={{ marginBottom: 4, color: '#888' }}>Size field</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {numericFields.map(f => (
              <button key={f.id} disabled={!canEditSettings}
                style={f.id === resolvedFieldId ? btnActive : btnBase}
                onClick={() => setActiveFieldId(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          {hasGroups && (
            <div style={{ marginTop: 6, color: '#666', fontSize: 11 }}>
              Grouped by: {groupInfo.map(g => fieldNameById[g.fieldId] ?? g.fieldId).join(' › ')}
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
          {isHierMode ? (
            <HViz tree={groupedTree} mode={effectiveMode as 'h-treemap' | 'h-icicle' | 'h-radial'} onLeafClick={handleLeafClick} />
          ) : (
            <Viz
              goals={goals}
              mode={effectiveMode as 'treemap' | 'radial' | 'bands'}
              activeUnit={activeUnit}
              unitKind="size"
              sortUnit={sortMode === 'index' ? '_index' : activeUnit}
              sortUnitKind={sortMode === 'index' ? 'order' : 'size'}
              frame={undefined}
              onUpdate={handleUpdate}
              onGoalClick={handleGoalClick}
            />
          )}
        </div>
      )}
    </div>
  )
}

initializeWidget(AllocVizWidget, process.env.WIDGET_PACKAGE_ID)
