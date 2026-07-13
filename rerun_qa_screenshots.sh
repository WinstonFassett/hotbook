#!/bin/bash
# Rerun QA with corrected section-targeted screenshots

set -e

echo "=== Rerunning QA with corrected screenshots ==="

# Remove old screenshots
rm -rf dogfood-output/screenshots
mkdir -p dogfood-output/screenshots/detailed

# Start dev server in background
echo "Starting dev server..."
npm run dev:demos &
SERVER_PID=$!

# Wait for server to be ready
sleep 8

# Run QA with updated screenshots
echo "Running QA tests..."
python3 qa_demos.py || true

echo "Running detailed interaction tests..."
python3 qa_detailed_interactions.py || true

# Kill dev server
kill $SERVER_PID 2>/dev/null || true

echo "=== QA complete! ==="
echo "Screenshots saved to dogfood-output/screenshots/"
ls -lh dogfood-output/screenshots/ | head -20
