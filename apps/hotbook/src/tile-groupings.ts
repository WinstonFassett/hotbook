import type { Tile, Dataset } from './persistence'
import type { TileGroupings, SingleGrouping } from '@hotbook/core'

const FIELD_OPTION = '_field'

function getGroupings(tile: Tile): TileGroupings {
  if (tile.groupings) return tile.groupings
  if (tile.groupBy) {
    return {
      rules: [{ level: 0, groupings: [{ field: tile.groupBy, dir: 'asc' }] }],
    }
  }
  return { rules: [] }
}

function getSingleGroupings(tile: Tile): SingleGrouping[] {
  return getGroupings(tile).rules[0]?.groupings ?? []
}

function isOrderByField(g: SingleGrouping): boolean {
  return g.orderBy === undefined || g.orderBy === g.field
}

function formatCustomOrder(g: SingleGrouping): string {
  return g.customOrder?.join(', ') ?? ''
}

function parseCustomOrder(value: string): string[] | undefined {
  const parts = value.split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}

function createRow(
  g: SingleGrouping,
  index: number,
  dimDefs: Dataset['dimDefs'],
  measureDefs: Dataset['measureDefs'],
  onChange: (index: number, next: SingleGrouping) => void,
  onRemove: (index: number) => void,
  onMove: (index: number, delta: number) => void,
): HTMLElement {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;'

  const fieldSel = document.createElement('select')
  fieldSel.className = 'tile-measure-select'
  dimDefs.forEach(d => {
    const o = document.createElement('option')
    o.value = d.key
    o.textContent = d.label
    fieldSel.appendChild(o)
  })
  fieldSel.value = g.field
  fieldSel.addEventListener('change', () => {
    const field = fieldSel.value
    onChange(index, { ...g, field, orderBy: isOrderByField(g) ? undefined : g.orderBy })
  })
  row.appendChild(fieldSel)

  const orderSel = document.createElement('select')
  orderSel.className = 'tile-measure-select'
  const fieldOpt = document.createElement('option')
  fieldOpt.value = FIELD_OPTION
  fieldOpt.textContent = 'Field'
  orderSel.appendChild(fieldOpt)
  measureDefs.forEach(m => {
    const o = document.createElement('option')
    o.value = m.key
    o.textContent = m.label
    orderSel.appendChild(o)
  })
  orderSel.value = isOrderByField(g) ? FIELD_OPTION : (g.orderBy ?? '')
  orderSel.addEventListener('change', () => {
    const orderBy = orderSel.value === FIELD_OPTION ? undefined : orderSel.value
    onChange(index, { ...g, orderBy, customOrder: undefined })
  })
  row.appendChild(orderSel)

  const dirSel = document.createElement('select')
  dirSel.className = 'tile-measure-select'
  ;[['asc', 'Asc'], ['desc', 'Desc']].forEach(([v, l]) => {
    const o = document.createElement('option')
    o.value = v
    o.textContent = l
    dirSel.appendChild(o)
  })
  dirSel.value = g.dir
  dirSel.addEventListener('change', () => onChange(index, { ...g, dir: dirSel.value as 'asc' | 'desc' }))
  row.appendChild(dirSel)

  const customInput = document.createElement('input')
  customInput.className = 'tile-measure-select'
  customInput.placeholder = 'custom order, comma'
  customInput.value = formatCustomOrder(g)
  customInput.style.display = isOrderByField(g) ? '' : 'none'
  customInput.addEventListener('change', () => {
    onChange(index, { ...g, customOrder: parseCustomOrder(customInput.value) })
  })
  row.appendChild(customInput)

  orderSel.addEventListener('change', () => {
    customInput.style.display = orderSel.value === FIELD_OPTION ? '' : 'none'
  })

  const upBtn = document.createElement('button')
  upBtn.textContent = '↑'
  upBtn.style.cssText = 'cursor:pointer'
  upBtn.addEventListener('click', () => onMove(index, -1))
  row.appendChild(upBtn)

  const downBtn = document.createElement('button')
  downBtn.textContent = '↓'
  downBtn.style.cssText = 'cursor:pointer'
  downBtn.addEventListener('click', () => onMove(index, 1))
  row.appendChild(downBtn)

  const removeBtn = document.createElement('button')
  removeBtn.textContent = '×'
  removeBtn.style.cssText = 'cursor:pointer'
  removeBtn.addEventListener('click', () => onRemove(index))
  row.appendChild(removeBtn)

  return row
}

export function buildGroupingsButton(
  tile: Tile,
  ds: Dataset,
  onGroupingsChange: (groupings: TileGroupings | undefined) => void,
): HTMLElement {
  const button = document.createElement('button')
  button.className = 'tile-groupings-btn'
  button.textContent = 'Group'
  button.title = 'Edit groupings'
  button.style.cssText = 'background:#222;border:1px solid #333;color:#ccc;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:12px'

  button.addEventListener('click', (e) => {
    e.stopPropagation()
    const dialog = document.createElement('dialog')
    dialog.className = 'tile-groupings-dialog'
    dialog.style.cssText = 'border:1px solid #333;border-radius:6px;background:#1a1a1a;color:#ccc;padding:12px;min-width:320px'

    const header = document.createElement('div')
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'
    const title = document.createElement('strong')
    title.textContent = 'Groupings'
    header.appendChild(title)
    const closeBtn = document.createElement('button')
    closeBtn.textContent = '×'
    closeBtn.style.cssText = 'cursor:pointer'
    closeBtn.addEventListener('click', () => dialog.close())
    header.appendChild(closeBtn)
    dialog.appendChild(header)

    const list = document.createElement('div')
    dialog.appendChild(list)

    let draft = getSingleGroupings(tile).map(g => ({ ...g }))

    function render() {
      list.innerHTML = ''
      draft.forEach((g, i) => {
        const row = createRow(
          g,
          i,
          ds.dimDefs,
          ds.measureDefs,
          (idx, next) => { draft[idx] = next; render() },
          (idx) => { draft = draft.filter((_, j) => j !== idx); render() },
          (idx, delta) => {
            const j = idx + delta
            if (j < 0 || j >= draft.length) return
            const tmp = draft[idx]!
            draft[idx] = draft[j]!
            draft[j] = tmp
            render()
          },
        )
        list.appendChild(row)
      })
    }
    render()

    const addBtn = document.createElement('button')
    addBtn.textContent = '+ Add grouping'
    addBtn.style.cssText = 'cursor:pointer;margin-top:6px'
    addBtn.addEventListener('click', () => {
      const firstDim = ds.dimDefs[0]?.key ?? ''
      draft.push({ field: firstDim, dir: 'asc' })
      render()
    })
    dialog.appendChild(addBtn)

    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px'

    const clearBtn = document.createElement('button')
    clearBtn.textContent = 'Clear'
    clearBtn.style.cssText = 'cursor:pointer'
    clearBtn.addEventListener('click', () => {
      onGroupingsChange(undefined)
      dialog.close()
    })
    actions.appendChild(clearBtn)

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = 'cursor:pointer'
    cancelBtn.addEventListener('click', () => dialog.close())
    actions.appendChild(cancelBtn)

    const applyBtn = document.createElement('button')
    applyBtn.textContent = 'Apply'
    applyBtn.style.cssText = 'cursor:pointer'
    applyBtn.addEventListener('click', () => {
      const groupings: TileGroupings | undefined = draft.length > 0
        ? { rules: [{ level: 0, groupings: draft }] }
        : undefined
      onGroupingsChange(groupings)
      dialog.close()
    })
    actions.appendChild(applyBtn)

    dialog.appendChild(actions)

    dialog.addEventListener('close', () => dialog.remove())
    document.body.appendChild(dialog)
    dialog.showModal()
  })

  return button
}
