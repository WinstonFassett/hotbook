# @winstonfassett/vizform-element

Framework-agnostic [custom elements](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements) wrapping [vizform-core](../vizform-core). Drop into any HTML page or framework without React.

Registers two elements: `<vizform-viz>` (flat) and `<vizform-hviz>` (hierarchical).

## Install

```sh
npm install @winstonfassett/vizform-element @winstonfassett/vizform-core
```

Or load the ESM build directly:

```html
<script type="module" src="./node_modules/@winstonfassett/vizform-element/dist/vizform-element.js"></script>
```

## Usage

```html
<vizform-viz id="chart" style="display:block; width:100%; height:400px;"></vizform-viz>

<script type="module">
  import '@winstonfassett/vizform-element'

  const el = document.getElementById('chart')
  el.goals = [
    { id: 'a', name: 'Alpha', color: '#e06c75', measurements: { value: 40 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
    { id: 'b', name: 'Beta',  color: '#61afef', measurements: { value: 60 }, archived: false, tags: [], urgent: false, important: false, createdAt: '', updatedAt: '' },
  ]
  el.mode = 'treemap'
  el.activeUnit = 'value'
  el.unitKind = 'size'
</script>
```

For hierarchical data, use `<vizform-hviz>` and set the `tree` property to a `GoalTree` object. See [`vizform-core`](../vizform-core/README.md) for the type definitions.

## Elements

| Element | Properties | Description |
|---|---|---|
| `<vizform-viz>` | `goals`, `mode`, `activeUnit`, `unitKind`, `sortUnit`, `sortUnitKind` | Flat viz (treemap / radial / bands) |
| `<vizform-hviz>` | `tree`, `mode` | Hierarchical viz (h-treemap / h-icicle / h-radial) |

The elements fill their containing block. Set an explicit width and height on the element or a parent.
