#!/bin/bash
# Build a self-contained release tarball: backend binary + static frontend
# Usage: ./build-release.sh
#   The frontend uses relative API paths (same origin).
#   Set NEXT_PUBLIC_API_BASE if you need a different API host at build time.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[BUILD]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

API_BASE="${1:-}"  # empty = same origin (recommended for production)
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
info "Building static frontend..."
cd "$PROJECT_ROOT/frontend"

if [ -n "$API_BASE" ]; then
    info "  API_BASE=$API_BASE"
    export NEXT_PUBLIC_API_BASE="$API_BASE"
fi

if [ "$USE_DENO" = true ]; then
    deno task build 2>&1
else
    npx next build 2>&1
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
