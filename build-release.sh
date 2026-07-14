#!/bin/bash
# Build a self-contained release tarball: backend binary + static frontend
# Usage: ./build-release.sh [api_base_url]
#   api_base_url defaults to http://localhost:8000

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[BUILD]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

API_BASE="${1:-http://localhost:8000}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="/tmp/ts-go-release"
RELEASE_NAME="ts-go-$(date +%Y%m%d_%H%M%S)"

# Add common tool locations to PATH
export PATH="$HOME/.deno/bin:$HOME/.cargo/bin:$PATH"

# Check prerequisites
info "Checking prerequisites..."
if ! command -v cargo &>/dev/null; then
    error "Rust/Cargo not found. Install from https://rustup.rs/"
    exit 1
fi
if ! command -v deno &>/dev/null; then
    warn "Deno not found. Trying npm/npx fallback..."
    if ! command -v npx &>/dev/null && ! command -v node &>/dev/null; then
        error "Neither Deno nor Node.js found. Install one."
        exit 1
    fi
    USE_DENO=false
    info "  Using npm/npx for frontend build"
else
    USE_DENO=true
fi

# Clean and prepare release directory
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/frontend"
mkdir -p "$RELEASE_DIR/backend"

# Step 1: Build Rust backend
info "Building Rust backend (release)..."
cd "$PROJECT_ROOT/backend"
cargo build --release
cp target/release/ts-sv-backend "$RELEASE_DIR/backend/"
info "  → Backend binary: $(du -h target/release/ts-sv-backend | cut -f1)"

# Step 2: Build static frontend
info "Building static frontend (API_BASE=$API_BASE)..."
cd "$PROJECT_ROOT/frontend"

if [ "$USE_DENO" = true ]; then
    NEXT_PUBLIC_API_BASE="$API_BASE" deno task build 2>&1
else
    NEXT_PUBLIC_API_BASE="$API_BASE" npx next build 2>&1
fi
# Copy the static export output
if [ -d "out" ]; then
    cp -r out/* "$RELEASE_DIR/frontend/"
elif [ -d ".next" ]; then
    # Fallback: copy .next build output
    warn "No 'out/' directory found, copying .next/ instead"
    cp -r .next/ "$RELEASE_DIR/frontend/.next"
else
    error "No build output found"
    exit 1
fi
info "  → Frontend static files: $(du -sh out 2>/dev/null | cut -f1)"

# Step 3: Create run script
info "Creating run script..."
cat > "$RELEASE_DIR/run.sh" << 'RUNSCRIPT'
#!/bin/bash
# One-command launcher for CryoET Tilt Series Curator
# Usage: ./run.sh [frontend_port] [backend_port]

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT="${1:-5173}"
BACKEND_PORT="${2:-8000}"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    info "Shutting down..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null && info "  Backend stopped"
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && info "  Frontend stopped"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Validate the binary
if [ ! -x "$RELEASE_DIR/backend/ts-sv-backend" ]; then
    error "Backend binary not found at backend/ts-sv-backend"
    exit 1
fi

# Check if frontend files exist
if [ ! -f "$RELEASE_DIR/frontend/index.html" ] && [ ! -d "$RELEASE_DIR/frontend/.next" ]; then
    error "Frontend files not found in frontend/"
    exit 1
fi

info "Starting backend on port $BACKEND_PORT..."
"$RELEASE_DIR/backend/ts-sv-backend" &
BACKEND_PID=$!
sleep 0.5
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    error "Backend failed to start"
    exit 1
fi
info "  ✓ Backend ready (PID: $BACKEND_PID)"

info "Starting frontend on port $FRONTEND_PORT..."

if [ -f "$RELEASE_DIR/frontend/index.html" ]; then
    # Static export — use any available HTTP server
    if command -v python3 &>/dev/null; then
        cd "$RELEASE_DIR/frontend"
        python3 -m http.server "$FRONTEND_PORT" --bind 0.0.0.0 &
        FRONTEND_PID=$!
        cd "$RELEASE_DIR"
        info "  ✓ Frontend via python3 (PID: $FRONTEND_PID)"
    elif command -v python &>/dev/null; then
        cd "$RELEASE_DIR/frontend"
        python -m SimpleHTTPServer "$FRONTEND_PORT" &
        FRONTEND_PID=$!
        cd "$RELEASE_DIR"
        info "  ✓ Frontend via python2 (PID: $FRONTEND_PID)"
    elif command -v busybox &>/dev/null; then
        busybox httpd -f -p "$FRONTEND_PORT" -h "$RELEASE_DIR/frontend" &
        FRONTEND_PID=$!
        info "  ✓ Frontend via busybox (PID: $FRONTEND_PID)"
    else
        error "No HTTP server found (python3/python/busybox). Install one."
        exit 1
    fi
else
    error "No index.html in frontend/ — build may have failed"
    exit 1
fi

echo ""
info "============================================"
info "  App is running!"
info ""
info "  Frontend:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${FRONTEND_PORT}"
info "  Backend:   http://localhost:${BACKEND_PORT}"
info ""
info "  Press Ctrl+C to stop both services"
info "============================================"
echo ""

# Wait for either process to exit
wait
RUNSCRIPT

chmod +x "$RELEASE_DIR/run.sh"

# Step 4: Create tarball
info "Creating tarball..."
cd /tmp
tar czf "$PROJECT_ROOT/$RELEASE_NAME.tar.gz" "ts-go-release"
cd "$PROJECT_ROOT"

echo ""
info "========================================"
info "  Release tarball created:"
info "    $RELEASE_NAME.tar.gz"
info "  Size: $(du -h "$RELEASE_NAME.tar.gz" | cut -f1)"
info ""
info "  Deploy on HPC:"
info "    scp $RELEASE_NAME.tar.gz user@hpc:~/"
info "    ssh user@hpc"
info "    tar xzf $RELEASE_NAME.tar.gz"
info "    cd ts-go-release"
info "    ./run.sh"
info "========================================"
