#!/bin/bash
# Rerun QA with corrected section-targeted screenshots

echo "=== Rerunning QA with corrected screenshots ==="

# Remove old screenshots
rm -rf dogfood-output/screenshots
mkdir -p dogfood-output/screenshots/detailed

# Start dev server in background and capture output
echo "Starting dev server..."
npm run dev:demos > /tmp/dev-server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start and extract the port
echo "Waiting for server startup..."
for i in {1..30}; do
  if grep -q "Local:" /tmp/dev-server.log; then
    PORT=$(grep "Local:" /tmp/dev-server.log | sed -E 's/.*:([0-9]+).*/\1/' | head -1)
    if [ ! -z "$PORT" ] && [ "$PORT" != "0" ]; then
      echo "Server ready on port $PORT"
      break
    fi
  fi
  sleep 1
done

# Verify server is responding
echo "Verifying server availability..."
for i in {1..10}; do
  if curl -s "http://127.0.0.1:$PORT/" > /dev/null 2>&1; then
    echo "Server is responding on port $PORT"
    break
  fi
  echo "  Attempt $i/10..."
  sleep 1
done

# Run QA with the actual port
echo "Running QA tests with port $PORT..."
PORT=$PORT python3 qa_demos.py || true

echo "Running detailed interaction tests with port $PORT..."
PORT=$PORT python3 qa_detailed_interactions.py || true

# Kill dev server
kill $SERVER_PID 2>/dev/null || true

echo "=== QA complete! ==="
echo "Screenshots saved to dogfood-output/screenshots/"
ls -lh dogfood-output/screenshots/ | head -20
