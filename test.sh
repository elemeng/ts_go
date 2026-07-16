#!/bin/bash
# Test the full release pipeline: build → untar → run
# Usage: ./test.sh [start_port]
#   Default port range is 8088-9000 (auto-detected)

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[TEST]${NC} $*"; }
warn()  { echo -e "${YELLOW}[TEST]${NC} $*"; }
error() { echo -e "${RED}[TEST]${NC} $*"; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_PORT="${1:-8088}"
TEST_DIR="/tmp/ts-go-test-$$"

# Find a free port — but if the first port is taken by our own binary, kill it
info "Checking port $START_PORT..."
if ss -tlnp 2>/dev/null | grep -Eq ":${START_PORT}[ :].*ts-sv-backend"; then
    OLD_PID=$(ss -tlnp 2>/dev/null | grep ":${START_PORT} " | sed 's/.*,pid=//; s/,.*//' | head -1)
    info "  → Port $START_PORT is taken by our own binary (PID: $OLD_PID). Killing it..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
    PORT="$START_PORT"
    info "  → Reusing port $PORT"
elif ss -tlnp 2>/dev/null | grep -Eq ":${START_PORT}[ :]"; then
    # Taken by something else — find a different free port
    info "  → Port $START_PORT is taken by another process. Scanning for free port..."
    PORT=$("$PROJECT_ROOT/port_free.sh" $((START_PORT + 1)) 9000 2>/dev/null) || {
        error "No free port found in range $((START_PORT + 1))-9000"
        exit 1
    }
    info "  → Using port $PORT"
else
    PORT="$START_PORT"
    info "  → Port $PORT is free"
fi

# Ensure we're on the right branch and clean
info "Using project at: $PROJECT_ROOT"

# Step 1: Build the release tarball
info "Step 1: Building release tarball..."
cd "$PROJECT_ROOT"
./build-release.sh 2>&1 | sed 's/^/  /'

# Find the tarball
TARBALL=$(ls -t ts-go-*.tar.gz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
    error "No tarball found after build"
    exit 1
fi
info "  → Tarball: $TARBALL ($(du -h "$TARBALL" | cut -f1))"

# Step 2: Untar
info "Step 2: Extracting to $TEST_DIR..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
tar xzf "$TARBALL" -C "$TEST_DIR"
EXTRACTED_DIR=$(ls "$TEST_DIR")
info "  → Extracted: $TEST_DIR/$EXTRACTED_DIR"

# Step 3: Start the server
info "Step 3: Starting server..."
cd "$TEST_DIR/$EXTRACTED_DIR"
export FRONTEND_DIR="$TEST_DIR/$EXTRACTED_DIR/frontend"
export PORT="$PORT"

# Start in background
export PORT
./run.sh &
SERVER_PID=$!

# Cleanup handler for interrupt
cleanup() {
    local exit_code=$?
    info "Cleaning up..."
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null || true
    exit $exit_code
}
trap cleanup SIGINT SIGTERM EXIT

# Wait for the server to be ready (poll up to 10s by port)
info "  → Waiting for server to be ready on port $PORT..."
for i in $(seq 1 10); do
    if kill -0 "$SERVER_PID" 2>/dev/null && ss -tlnp 2>/dev/null | grep -q ":${PORT}[ :]"; then
        info "  → Server ready after ${i}s"
        break
    fi
    sleep 1
done

# Check if it's running
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    error "Server failed to start (check output above)"
    exit 1
fi

# Detect the actual port (the backend may have picked a different one)
ACTUAL_PORT=$(
    ss -tlnp 2>/dev/null \
        | grep "ts-sv-backend" \
        | awk '{print $4}' \
        | awk -F: '{print $NF}' \
        | head -1
)
ACTUAL_PORT="${ACTUAL_PORT:-$PORT}"

info "  → Server PID: $SERVER_PID"
info "  → Listening on port: $ACTUAL_PORT"

# Step 4: Verify it responds
info "Step 4: Verifying endpoints..."
sleep 1

echo ""
info "--- GET / ---"
curl -s -o /dev/null -w "  HTTP %{http_code}, Size: %{size_download} bytes\n" "http://localhost:${ACTUAL_PORT}/" || warn "  Root endpoint not reachable"

info "--- GET /health ---"
curl -s "http://localhost:${ACTUAL_PORT}/health" | head -c 200
echo ""
echo ""

info "--- GET /api/files/user-home ---"
curl -s "http://localhost:${ACTUAL_PORT}/api/files/user-home" | head -c 200
echo ""
echo ""

# Step 5: Verify the frontend HTML contains the app title
FRONTEND_TITLE=$(curl -s "http://localhost:${ACTUAL_PORT}/" | grep -o '<title>[^<]*</title>' | head -1 || echo "")
if [ -n "$FRONTEND_TITLE" ]; then
    info "✅ Frontend title: $FRONTEND_TITLE"
else
    warn "⚠  Could not find <title> in frontend response"
fi

# Step 6: Keep running — don't clean up
echo ""
info "========================================"
info "  Server is running!"
info ""
info "  http://localhost:${ACTUAL_PORT}"
info ""
info "  Press Ctrl+C to stop"
info "========================================"
echo ""

# Wait for the server process
wait "$SERVER_PID"
