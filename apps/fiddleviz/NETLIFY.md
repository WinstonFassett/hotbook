# Hotbook-build.netlify Deployment

## Two Deployment Targets

Hotbook is deployed in two contexts:

### 1. Standalone fiddleviz-build.netlify.app

**Config:** `apps/fiddleviz-build.netlify.toml` (this file)
**Build:** `npm run build:fiddleviz` (builds without base path)
**Served at:** Root path `/`

This is the standalone fiddleviz demo site.

### 2. Part of fiddleviz docs site

**Config:** `netlify.toml` (repo root)
**Build:** `npm run build` → `scripts/build-site.sh` (builds with `--base /fiddleviz/`)
**Served at:** Subpath `/fiddleviz/`

The main fiddleviz docs site includes fiddleviz at the `/fiddleviz/` subpath.

## Netlify Site Configuration

For `fiddleviz-build.netlify.app` to use the standalone config:

1. In Netlify dashboard for fiddleviz-build.netlify.app
2. Build settings should auto-detect `apps/fiddleviz-build.netlify.toml`
3. Or manually set:
   - **Base directory:** (leave empty, config handles it)
   - **Build command:** (auto-detected from netlify.toml)
   - **Publish directory:** (auto-detected from netlify.toml)
   - **Branch:** `main`

## Troubleshooting

If fiddleviz-build.netlify.app shows React errors or blank page:
- Check that it's using `apps/fiddleviz-build.netlify.toml` config (NOT root `netlify.toml`)
- Clear build cache in Netlify dashboard
- Trigger new deploy from `main` branch
- Assets should load from `/assets/...` not `/fiddleviz/assets/...`
