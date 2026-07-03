#!/usr/bin/env bash
set -euo pipefail

# Build the full docs site with demos mounted at subpaths.
# Output: apps/docs/dist (the Netlify publish directory)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building packages..."
npm run build -w packages/vizform-charts
npm run build -w packages/vizform-vanilla-d3
npm run build -w packages/vizform-react-d3

echo "==> Building docs..."
npm run build -w apps/docs

echo "==> Building sliceboard..."
(cd apps/sliceboard && npx vite build --base /sliceboard/)

echo "==> Building bireactive layercharts demo..."
(cd apps/vanilla-bireactive-layercharts-spike && npx vite build --base /demos/bireactive-layercharts/)

echo "==> Building bireactive demo..."
(cd apps/vanilla-bireactive-spike && npx vite build --base /demos/bireactive/)

echo "==> Building bireactive native layout demo..."
(cd apps/vanilla-bireactive-native-layout-spike && npx vite build --base /demos/bireactive-native-layout/)

echo "==> Assembling site..."
# Copy demo builds into docs dist at their subpaths
cp -r apps/sliceboard/dist apps/docs/dist/sliceboard
mkdir -p apps/docs/dist/demos
cp -r apps/vanilla-bireactive-layercharts-spike/dist apps/docs/dist/demos/bireactive-layercharts
cp -r apps/vanilla-bireactive-spike/dist apps/docs/dist/demos/bireactive
cp -r apps/vanilla-bireactive-native-layout-spike/dist apps/docs/dist/demos/bireactive-native-layout

echo "==> Site built at apps/docs/dist"
