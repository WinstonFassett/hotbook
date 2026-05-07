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
  FieldType,
} from '@apitable/widget-sdk'
import { Viz } from './components/Viz'
import { pickColor } from './colors'
import type { Goal, ViewMode } from './types'

const NUMERIC_TYPES = new Set<string>([
  FieldType.Number,
  FieldType.Currency,
  FieldType.Percent,
  FieldType.Rating,
])

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

  const numericFields = useMemo(
    () => fields.filter(f => NUMERIC_TYPES.has(f.type as string)),
    [fields]
  )

  const resolvedFieldId =
    numericFields.find(f => f.id === activeFieldId)?.id ?? numericFields[0]?.id ?? ''
  const activeField = fields.find(f => f.id === resolvedFieldId)
  const activeUnit = activeField?.name ?? 'value'

  // fieldName → fieldId map for write-back
  const fieldIdByName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of fields) m[f.name] = f.id
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

  const handleUpdate = (id: string, patch: Partial<Goal>) => {
    if (!patch.measurements || !datasheet) return
    const updates: Record<string, unknown> = {}
    for (const [unitName, val] of Object.entries(patch.measurements)) {
      const fid = fieldIdByName[unitName]
      if (fid) updates[fid] = val
    }
    if (Object.keys(updates).length) {
      datasheet.setRecord(id, updates as never)
    }
  }

  const handleGoalClick = (goal: Goal) => {
    expandRecord({ recordIds: [goal.id] })
  }

  const btnBase: React.CSSProperties = {
    padding: '2px 10px',
    borderRadius: 4,
    border: '1px solid #444',
    background: 'transparent',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 11,
  }
  const btnActive: React.CSSProperties = {
    ...btnBase,
    background: '#444',
    color: '#fff',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111', color: '#ccc' }}>

      {/* Mode strip */}
      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, alignItems: 'center' }}>
        {(['treemap', 'radial', 'bands'] as ViewMode[]).map(m => (
          <button key={m} style={vizMode === m ? btnActive : btnBase} onClick={() => setVizMode(m)}>
            {m}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            style={sortMode === 'index' ? btnActive : btnBase}
            onClick={() => setSortMode('index')}
            title="Sort by view order"
          >idx</button>
          <button
            style={sortMode === 'size' ? btnActive : btnBase}
            onClick={() => setSortMode('size')}
            title="Sort by value"
          >↓val</button>
        </div>
      </div>

      {/* Settings panel */}
      {isShowingSettings && numericFields.length > 0 && (
        <div style={{ padding: '8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0, fontSize: 12 }}>
          <div style={{ marginBottom: 4, color: '#888' }}>Size field</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {numericFields.map(f => (
              <button
                key={f.id}
                disabled={!canEditSettings}
                style={f.id === resolvedFieldId ? btnActive : btnBase}
                onClick={() => setActiveFieldId(f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
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
          <Viz
            goals={goals}
            mode={vizMode}
            activeUnit={activeUnit}
            unitKind="size"
            sortUnit={sortMode === 'index' ? '_index' : activeUnit}
            sortUnitKind={sortMode === 'index' ? 'order' : 'size'}
            frame={undefined}
            onUpdate={handleUpdate}
            onGoalClick={handleGoalClick}
          />
        </div>
      )}
    </div>
  )
}

initializeWidget(AllocVizWidget, process.env.WIDGET_PACKAGE_ID)
