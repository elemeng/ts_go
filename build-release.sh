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
RELEASE_DIR="/tmp/TomoCurator-release"
RELEASE_NAME="TomoCurator-$(date +%Y%m%d_%H%M%S)"

# Add common tool locations to PATH
export PATH="$HOME/.deno/bin:$HOME/.cargo/bin:$PATH"

MUSL_TARGET="x86_64-unknown-linux-musl"

# Check prerequisites
info "Checking prerequisites..."
if ! command -v cargo &>/dev/null; then
    error "Rust/Cargo not found. Install from https://rustup.rs/"
    exit 1
fi

# Set up musl target for fully static linking
info "Setting up musl target for fully static binary..."
if ! rustup target list --installed 2>/dev/null | grep -q "$MUSL_TARGET"; then
    info "  Installing musl target (x86_64-unknown-linux-musl)..."
    rustup target add "$MUSL_TARGET"
fi

# Check for musl-gcc linker
MUSL_GCC=""
if command -v musl-gcc &>/dev/null; then
    MUSL_GCC="musl-gcc"
    info "  Using musl-gcc for fully static linking"
else
    warn "  musl-gcc not found. Trying system gcc (may produce dynamically linked binary)."
    warn "  For fully static linking, install: sudo apt install musl-tools  (or equivalent)"
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

# Step 1: Build Rust backend (fully static with musl)
info "Building Rust backend (release, musl static)..."
cd "$PROJECT_ROOT/backend"

BUILD_ARGS=(build --release --target "$MUSL_TARGET")
if [ -n "$MUSL_GCC" ]; then
    CC_CMD="$MUSL_GCC" cargo "${BUILD_ARGS[@]}"
else
    cargo "${BUILD_ARGS[@]}"
fi

cp "target/$MUSL_TARGET/release/ts-sv-backend" "$RELEASE_DIR/backend/"
info "  → Backend binary: $(du -h "target/$MUSL_TARGET/release/ts-sv-backend" | cut -f1)"
info "  → Static linking check:"
file "$RELEASE_DIR/backend/ts-sv-backend" | head -1

# Step 2: Build static frontend
info "Building static frontend..."
cd "$PROJECT_ROOT/frontend"
rm -rf .next out  # fresh build, no stale cache

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
# Use the tracked scripts/run.sh (single source of truth)
cp "$PROJECT_ROOT/scripts/run.sh" "$RELEASE_DIR/run.sh"
chmod +x "$RELEASE_DIR/run.sh"

chmod +x "$RELEASE_DIR/run.sh"

# Step 4: Create tarball
info "Creating tarball..."
cd /tmp
tar czf "$PROJECT_ROOT/$RELEASE_NAME.tar.gz" "TomoCurator-release"
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
info "    cd TomoCurator-release"
info "    ./run.sh"
info "========================================"
