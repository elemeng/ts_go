#!/bin/bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If running from scripts/ subdirectory, adjust to project root
if [[ "$(basename "$SCRIPT_DIR")" == "scripts" ]]; then
    RELEASE_DIR="$(dirname "$SCRIPT_DIR")"
else
    RELEASE_DIR="$SCRIPT_DIR"
fi
BINARY_PID=""
ACTUAL_PORT=""

cleanup() {
    local exit_code=$?
    info "Shutting down..."
    [ -n "$BINARY_PID" ] && kill "$BINARY_PID" 2>/dev/null && wait "$BINARY_PID" 2>/dev/null && info "  Stopped"
    exit $exit_code
}
trap cleanup SIGINT SIGTERM EXIT

if [ ! -x "$RELEASE_DIR/backend/ts-sv-backend" ]; then
    error "Binary not found at $RELEASE_DIR/backend/ts-sv-backend"
    exit 1
fi

export FRONTEND_DIR="$RELEASE_DIR/frontend"

info "Starting server (auto port detection)..."
"$RELEASE_DIR/backend/ts-sv-backend" &
BINARY_PID=$!

while read -t 3 line; do
    if [[ "$line" =~ ^__PORT__=([0-9]+)$ ]]; then
        ACTUAL_PORT="${BASH_REMATCH[1]}"
        break
    fi
done < <(tail --pid=$BINARY_PID -f /proc/$BINARY_PID/fd/1 2>/dev/null || sleep 1)

if [ -z "$ACTUAL_PORT" ]; then
    if ! kill -0 "$BINARY_PID" 2>/dev/null; then
        error "Server failed to start."
        exit 1
    fi
    sleep 1
    ACTUAL_PORT=$(ss -tlnp 2>/dev/null | grep "$BINARY_PID" | awk '{print $4}' | awk -F: '{print $NF}' | head -1)
fi

[ -z "$ACTUAL_PORT" ] && ACTUAL_PORT="8088"

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
info "============================================"
info "  App is running!"
info ""
info "  http://${IP}:${ACTUAL_PORT}"
info ""
info "  Press Ctrl+C to stop"
info "============================================"
echo ""

wait "$BINARY_PID"
