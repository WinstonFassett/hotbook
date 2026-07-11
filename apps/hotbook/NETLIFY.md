# Hotbook-build.netlify Deployment

## Two Deployment Targets

Hotbook is deployed in two contexts:

### 1. Standalone hotbook-build.netlify.app

**Config:** `apps/hotbook-build.netlify.toml` (this file)
**Build:** `npm run build:hotbook` (builds without base path)
**Served at:** Root path `/`

This is the standalone hotbook demo site.

### 2. Part of hotbook docs site

**Config:** `netlify.toml` (repo root)
**Build:** `npm run build` → `scripts/build-site.sh` (builds with `--base /hotbook/`)
**Served at:** Subpath `/hotbook/`

The main hotbook docs site includes hotbook at the `/hotbook/` subpath.

## Netlify Site Configuration

For `hotbook-build.netlify.app` to use the standalone config:

1. In Netlify dashboard for hotbook-build.netlify.app
2. Build settings should auto-detect `apps/hotbook-build.netlify.toml`
3. Or manually set:
   - **Base directory:** (leave empty, config handles it)
   - **Build command:** (auto-detected from netlify.toml)
   - **Publish directory:** (auto-detected from netlify.toml)
   - **Branch:** `main`

## Troubleshooting

If hotbook-build.netlify.app shows React errors or blank page:
- Check that it's using `apps/hotbook-build.netlify.toml` config (NOT root `netlify.toml`)
- Clear build cache in Netlify dashboard
- Trigger new deploy from `main` branch
- Assets should load from `/assets/...` not `/hotbook/assets/...`
