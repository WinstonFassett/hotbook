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
(cd apps/hotbook && npx vite build --base /demos/hotbook/)

echo "==> Building chart demos (includes layout)..."
(cd apps/demos && npx vite build --base /demos/charts/)

echo "==> Assembling site..."
# Copy demo builds into docs dist at their subpaths
mkdir -p apps/docs/dist/demos
cp -r apps/hotbook/dist apps/docs/dist/demos/hotbook
cp -r apps/demos/dist apps/docs/dist/demos/charts

echo "==> Site built at apps/docs/dist"
