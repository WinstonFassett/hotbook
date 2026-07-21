# fiddleviz

Demo app for [fiddleviz](../../README.md). Multi-board data table with live proportional and hierarchical visualizations.

**Live:** [fiddleviz-build.netlify.app](https://fiddleviz-build.netlify.app)

## What it does

- Editable table (add/remove/rename rows, set values, optional group column)
- Multiple chart types (bar, line, area, pie, treemap, sunburst, icicle, gantt, sankey, etc.)
- Multiple named boards with localStorage persistence
- Shareable board links via URL state

## Dev

```sh
npm install        # from repo root
npm run dev -w apps/fiddleviz
```

Opens at `http://fiddleviz.localhost` via portless.

## Build

```sh
npm run build -w apps/fiddleviz
```

Deployed to Netlify on push to `main` via [`netlify.toml`](./netlify.toml).
