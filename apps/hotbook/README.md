# hotbook

Demo app for [vizform](../../README.md). Multi-board data table with live proportional and hierarchical visualizations.

**Live:** [sliceboard.netlify.app](https://sliceboard.netlify.app)

## What it does

- Editable table (add/remove/rename rows, set values, optional group column)
- Six viz modes: treemap, radial, bands, h-treemap, h-icicle, h-radial
- Multiple named boards with localStorage persistence
- Shareable board links via URL state

## Dev

```sh
npm install        # from repo root
npm run dev -w apps/hotbook
```

Opens at `http://localhost:5173`.

## Build

```sh
npm run build -w apps/hotbook
```

Deployed to Netlify on push to `main` via [`netlify.toml`](../../netlify.toml).
