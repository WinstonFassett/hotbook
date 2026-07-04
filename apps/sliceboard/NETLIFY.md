# Sliceboard Netlify Deployment

## Two Deployment Targets

Sliceboard is deployed in two contexts:

### 1. Standalone sliceboard.netlify.app

**Config:** `apps/sliceboard/netlify.toml` (this file)
**Build:** `npm run build:sliceboard` (builds without base path)
**Served at:** Root path `/`

This is the standalone sliceboard demo site.

### 2. Part of vizform docs site

**Config:** `netlify.toml` (repo root)
**Build:** `npm run build` → `scripts/build-site.sh` (builds with `--base /sliceboard/`)
**Served at:** Subpath `/sliceboard/`

The main vizform docs site includes sliceboard at the `/sliceboard/` subpath.

## Netlify Site Configuration

For `sliceboard.netlify.app` to use the standalone config:

1. In Netlify dashboard for sliceboard.netlify.app
2. Build settings should auto-detect `apps/sliceboard/netlify.toml`
3. Or manually set:
   - **Base directory:** (leave empty, config handles it)
   - **Build command:** (auto-detected from netlify.toml)
   - **Publish directory:** (auto-detected from netlify.toml)
   - **Branch:** `main`

## Troubleshooting

If sliceboard.netlify.app shows React errors or blank page:
- Check that it's using `apps/sliceboard/netlify.toml` config (NOT root `netlify.toml`)
- Clear build cache in Netlify dashboard
- Trigger new deploy from `main` branch
- Assets should load from `/assets/...` not `/sliceboard/assets/...`
