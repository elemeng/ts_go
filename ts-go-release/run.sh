#!/bin/bash
# One-command launcher for CryoET Tilt Series Curator
# Backend serves both the API and the static frontend on one port.
# Usage: ./run.sh [port]

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8000}"
BINARY_PID=""

cleanup() {
    info "Shutting down..."
    [ -n "$BINARY_PID" ] && kill "$BINARY_PID" 2>/dev/null && info "  Stopped"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

if [ ! -x "$RELEASE_DIR/backend/ts-sv-backend" ]; then
    error "Binary not found at backend/ts-sv-backend"
    exit 1
fi

# Point the binary to the frontend directory next to it
export FRONTEND_DIR="$RELEASE_DIR/frontend"

info "Starting server on port $PORT..."
"$RELEASE_DIR/backend/ts-sv-backend" &
BINARY_PID=$!
sleep 0.5

if ! kill -0 "$BINARY_PID" 2>/dev/null; then
    error "Server failed to start"
    exit 1
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
info "============================================"
info "  App is running!"
info ""
info "  http://${IP}:${PORT}"
info ""
info "  Press Ctrl+C to stop"
info "============================================"
echo ""

wait
