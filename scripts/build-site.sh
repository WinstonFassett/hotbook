#!/usr/bin/env bash
set -euo pipefail

# Build the full docs site with demos mounted at subpaths.
# Output: apps/docs/dist (the Netlify publish directory)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building packages..."
npm run build -w packages/bireactive
npm run build -w packages/d3

echo "==> Building docs..."
npm run build -w apps/docs

echo "==> Building hotbook..."
(cd apps/hotbook && npx vite build --base /hotbook/)

echo "==> Building bireactive layercharts demo..."
(cd apps/vanilla-bireactive-layercharts-spike && npx vite build --base /demos/bireactive-layercharts/)

echo "==> Building layout demo..."
(cd packages/layout && npx vite build --base /demos/layout/)

echo "==> Assembling site..."
# Copy demo builds into docs dist at their subpaths
cp -r apps/hotbook/dist apps/docs/dist/hotbook
mkdir -p apps/docs/dist/demos
cp -r apps/vanilla-bireactive-layercharts-spike/dist apps/docs/dist/demos/bireactive-layercharts
cp -r packages/layout/dist apps/docs/dist/demos/layout

echo "==> Site built at apps/docs/dist"
