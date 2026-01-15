#!/bin/bash

# Linux port release script
# Find and terminate processes occupying specified ports (supports multiple ports)

# Default port list (space-separated)
DEFAULT_PORTS="8000 5173"
PORTS=${*:-$DEFAULT_PORTS}
FORCE=${FORCE:-false}  # Force mode can be set via environment variable

# Colored output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# Detect PID occupying the port
get_pid() {
    local port=$1
    if command -v lsof &> /dev/null; then
        lsof -ti :${port} -sTCP:LISTEN 2>/dev/null
    else
        ss -tuln -p | grep -w ":${port}" | grep -oP 'pid=\K\d+' | head -1
    fi
}

# Terminate single port
kill_port() {
    local port=$1
    local pid=$(get_pid $port)

    [ -z "$pid" ] && { log_success "Port $port is free"; return 0; }

    # Get process info
    local info=$(ps -p $pid -o user=,pid=,command= 2>/dev/null)
    [ -z "$info" ] && { log_error "Failed to get process info for port $port"; return 1; }

    echo "----------------------------------------"
    log_info "Port $port is occupied:"
    echo "  $info"
    echo "----------------------------------------"

    # Permission check
    local SUDO=""
    if [ "$EUID" -ne 0 ] && [ "$(echo $info | awk '{print $1}')" != "$(whoami)" ]; then
        log_warning "sudo permission required"
        SUDO="sudo"
    fi

    # Terminate process
    if [ "$FORCE" = "true" ]; then
        log_warning "Forcefully terminating PID:$pid"
        $SUDO kill -TERM $pid
    else
        read -p "Terminate this process? [y/N] " -n 1 -r
        echo
        [[ $REPLY =~ ^[Yy]$ ]] || { log_info "Skipping"; return 0; }
        $SUDO kill -TERM $pid
    fi

    # Verify
    sleep 0.3
    if kill -0 $pid 2>/dev/null; then
        log_warning "Force killing PID:$pid"
        $SUDO kill -KILL $pid
    fi

    log_success "Port $port has been released"
}

# Main logic
log_info "Checking ports: $PORTS"

for port in $PORTS; do
    kill_port $port
done

log_info "All operations completed"