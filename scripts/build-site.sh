#!/usr/bin/env bash
set -euo pipefail

# Build the full docs site with the consolidated /demos/ page + fiddleviz app.
# Output: apps/docs/dist (the Netlify publish directory)
#
# Layout:
#   /              docs index (Astro)
#   /demos/        consolidated single-page demo index (apps/demos vite build)
#                  every chart, gantt, treetable, layout demo lives here as a
#                  hash-anchored section (#gantt, #treetable, #layout-nested, ...)
#   /demos/bidirectional/  bidirectional-binding demos (Astro page)
#   /fiddleviz/      fiddleviz fiddleviz app (vite build)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building packages..."
npm run build -w packages/bireactive
npm run build -w packages/d3

echo "==> Building docs..."
npm run build -w apps/docs

echo "==> Building demos (single consolidated page)..."
(cd apps/demos && npx vite build --base /demos/)

echo "==> Building fiddleviz app..."
(cd apps/fiddleviz && npx vite build --base /fiddleviz/)

echo "==> Assembling site..."
# The demos page is /demos/ — copy over the top of any Astro-emitted /demos/
# stubs (bidirectional/ stays because it lives at /demos/bidirectional/).
mkdir -p apps/docs/dist/demos
cp -r apps/demos/dist/. apps/docs/dist/demos/
cp -r apps/fiddleviz/dist apps/docs/dist/fiddleviz

echo "==> Site built at apps/docs/dist"
