#!/bin/bash
# CryoET Tilt Series Viewer - Smart Service Orchestration
# Production-ready with intelligent start/stop/restart behavior

set -euo pipefail

# ==================== CONFIGURATION ====================
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# Project structure
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly FRONTEND_DIR="$PROJECT_ROOT"
readonly BACKEND_DIR="$PROJECT_ROOT/backend"
readonly LOGS_DIR="$PROJECT_ROOT/logs"

# Service configuration
readonly FRONTEND_PORT=${FRONTEND_PORT:-5173}
readonly BACKEND_PORT=${BACKEND_PORT:-8000}
readonly FRONTEND_HOST=${FRONTEND_HOST:-0.0.0.0}
readonly BACKEND_HOST=${BACKEND_HOST:-0.0.0.0}

# Runtime files
readonly FRONTEND_PID_FILE="$PROJECT_ROOT/.frontend.pid"
readonly BACKEND_PID_FILE="$PROJECT_ROOT/.backend.pid"
readonly FRONTEND_LOG="$LOGS_DIR/frontend.log"
readonly BACKEND_LOG="$LOGS_DIR/backend.log"

# ==================== LOGGING & UTILITIES ====================
log() {
    local level=$1; shift
    local color=$NC
    case "$level" in
        INFO)  color=$BLUE ;;
        SUCCESS) color=$GREEN ;;
        WARN)  color=$YELLOW ;;
        ERROR) color=$RED ;;
    esac
    printf "${color}[%s]${NC} %s - %s\n" "$level" "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

info()    { log INFO "$@"; }
success() { log SUCCESS "$@"; }
warn()    { log WARN "$@"; }
error()   { log ERROR "$@"; }

require_command() {
    command -v "$1" &>/dev/null || { error "Required command not found: $1"; exit 1; }
}

# ==================== PROCESS MANAGEMENT ====================
get_pid_from_file() {
    [ -f "$1" ] && cat "$1" 2>/dev/null || echo ""
}

is_process_alive() {
    [ -n "$1" ] && ps -p "$1" &>/dev/null
}

is_port_listening() {
    lsof -ti :"$1" -sTCP:LISTEN &>/dev/null
}

cleanup_stale_pid() {
    local pid=$(get_pid_from_file "$1")
    if [ -n "$pid" ] && ! is_process_alive "$pid"; then
        warn "Removing stale PID file for $2 (PID: $pid)"
        rm -f "$1"
    fi
}

cleanup_all_stale_pids() {
    cleanup_stale_pid "$FRONTEND_PID_FILE" "frontend"
    cleanup_stale_pid "$BACKEND_PID_FILE" "backend"
}

# ==================== SMART SERVICE CHECKS ====================
is_service_running() {
    local service=$1
    local pid_file=$2
    local port=$3
    
    local pid=$(get_pid_from_file "$pid_file")
    if [ -n "$pid" ] && is_process_alive "$pid"; then
        if is_port_listening "$port"; then
            return 0
        else
            warn "$service process exists but port $port is not listening"
            return 1
        fi
    fi
    return 1
}

ensure_directories() {
    mkdir -p "$LOGS_DIR"
}

# ==================== BACKEND ENVIRONMENT SETUP ====================
ensure_backend_environment() {
    info "Ensuring backend environment..."

    # Ensure uv is installed in user environment
    if ! command -v uv &>/dev/null; then
        info "Installing uv package manager..."
        pip install uv || warn "Failed to install uv, continuing anyway..."
    fi

    # Sync dependencies if needed (missing flag or pyproject newer)
    # Run from project root to ensure uv operates in correct directory
    cd "$PROJECT_ROOT"
    if ! uv sync; then
        warn "uv sync failed or timed out, attempting to continue anyway..."
    fi
    cd - >/dev/null
}

# ==================== UPDATE .ENV FILE ====================
update_env_file() {
    info "Updating .env file with backend configuration..."

    # Get the actual IP address that the backend will bind to
    # If BACKEND_HOST is 0.0.0.0, we need to get the actual IP address
    local api_host="$BACKEND_HOST"
    if [ "$BACKEND_HOST" = "0.0.0.0" ]; then
        # Try to get the primary IP address
        api_host=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
    fi

    # Update or create .env file with the backend URL
    cd "$PROJECT_ROOT"
    cat > .env << EOF
VITE_API_BASE=http://${api_host}:${BACKEND_PORT}
EOF
    info "  → API_BASE set to: http://${api_host}:${BACKEND_PORT}"
}

# ==================== SMART SERVICE CONTROL ====================
start_frontend() {
    # Idempotent check
    if is_service_running "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
        local pid=$(get_pid_from_file "$FRONTEND_PID_FILE")
        success "Frontend already running (PID: $pid)"
        info "  → http://${FRONTEND_HOST}:${FRONTEND_PORT}"
        return 0
    fi
    
    info "Starting frontend..."
    cleanup_stale_pid "$FRONTEND_PID_FILE" "frontend"
    
    if is_port_listening "$FRONTEND_PORT"; then
        error "Frontend port $FRONTEND_PORT is in use by another process"
        exit 1
    fi
    
# Install dependencies if needed
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        info "Installing frontend dependencies..."
        if ! bun install --frozen-lockfile 2>/dev/null; then
            if ! npm ci; then
                warn "bun install and npm ci failed or timed out, attempting to continue anyway..."
            fi
        fi
    fi

    ensure_directories
    nohup bun run dev --host "$FRONTEND_HOST" > "$FRONTEND_LOG" 2>&1 &
    local pid=$!
    
    # Verify process started
    sleep 1
    if ! is_process_alive "$pid"; then
        error "Frontend process died immediately"
        tail -n 20 "$FRONTEND_LOG" >&2
        exit 1
    fi
    
    echo "$pid" > "$FRONTEND_PID_FILE"
    
    # Wait for port
    for i in {1..15}; do
        if is_port_listening "$FRONTEND_PORT"; then
            success "Frontend started (PID: $pid)"
            info "  → http://${FRONTEND_HOST}:${FRONTEND_PORT}"
            info "  → Log: $FRONTEND_LOG"
            return 0
        fi
        sleep 1
        [ $(( i % 5 )) -eq 0 ] && info "Waiting for frontend... ($i/15 seconds)"
    done
    
    error "Frontend failed to start within timeout"
    tail -n 30 "$FRONTEND_LOG" >&2
    exit 1
}

start_backend() {
    # Idempotent check
    if is_service_running "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
        local pid=$(get_pid_from_file "$BACKEND_PID_FILE")
        success "Backend already running (PID: $pid)"
        info "  → API: http://${BACKEND_HOST}:${BACKEND_PORT}"
        return 0
    fi
    
    info "Starting backend..."
    cleanup_stale_pid "$BACKEND_PID_FILE" "backend"
    
    if is_port_listening "$BACKEND_PORT"; then
        error "Backend port $BACKEND_PORT is in use by another process"
        exit 1
    fi
    
    ensure_backend_environment
    
    # Activate venv and start service
    source ".venv/bin/activate"
    cd "$BACKEND_DIR"
    nohup uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload > "$BACKEND_LOG" 2>&1 &
    local pid=$!
    cd - >/dev/null
    
    # Verify process started
    sleep 1
    if ! is_process_alive "$pid"; then
        error "Backend process died immediately"
        tail -n 30 "$BACKEND_LOG" >&2
        exit 1
    fi
    
    echo "$pid" > "$BACKEND_PID_FILE"
    
    # Wait for port
    for i in {1..20}; do
        if is_port_listening "$BACKEND_PORT"; then
            success "Backend started (PID: $pid)"
            info "  → API: http://${BACKEND_HOST}:${BACKEND_PORT}"
            info "  → Docs: http://${BACKEND_HOST}:${BACKEND_PORT}/docs"
            info "  → Log: $BACKEND_LOG"
            return 0
        fi
        sleep 1
        [ $(( i % 5 )) -eq 0 ] && info "Waiting for backend... ($i/20 seconds)"
    done
    
    error "Backend failed to start within timeout"
    tail -n 30 "$BACKEND_LOG" >&2
    exit 1
}

start_all() {
    info "Starting all services..."
    ensure_directories
    update_env_file
    
    # Start only if not running
    local started=0
    
    if ! is_service_running "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
        start_backend
        started=1
        sleep 1
    fi
    
    if ! is_service_running "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
        start_frontend
        started=1
    fi
    
    if [ $started -eq 0 ]; then
        info "All services already running"
    else
        success "All services started"
    fi
}

stop_service() {
    local service=$1
    local pid_file=$2
    local port=$3
    
    info "Stopping $service..."
    local pid=$(get_pid_from_file "$pid_file")
    local killed=0
    
    if [ -n "$pid" ] && is_process_alive "$pid"; then
        kill "$pid" 2>/dev/null || true
        
        for i in {1..20}; do
            if ! is_process_alive "$pid"; then
                success "$service stopped gracefully (PID: $pid)"
                killed=1
                break
            fi
            sleep 0.5
        done
        
        if [ $killed -eq 0 ]; then
            warn "$service did not stop gracefully, force killing..."
            kill -KILL "$pid" 2>/dev/null || true
            sleep 1
            success "$service forcefully stopped (PID: $pid)"
            killed=1
        fi
    fi
    
    rm -f "$pid_file"
    
    if [ $killed -eq 0 ]; then
        warn "$service was not running"
        return 1
    fi
    
    return 0
}

stop_all() {
    info "Stopping all services..."
    local stopped=0
    
    if is_service_running "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
        stop_service "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"
        stopped=1
        sleep 2
    fi
    
    if is_service_running "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
        stop_service "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"
        stopped=1
        sleep 1
    fi
    
    if [ $stopped -eq 0 ]; then
        warn "No services were running"
    else
        success "All services stopped"
    fi
}

restart_service() {
    local service=$1
    
    case "$service" in
        frontend)
            if is_service_running "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"; then
                info "Restarting frontend..."
                stop_service "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"
                sleep 1
            else
                warn "Frontend is not running, starting instead..."
            fi
            start_frontend
            ;;
        backend)
            if is_service_running "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"; then
                info "Restarting backend..."
                stop_service "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"
                sleep 2
            else
                warn "Backend is not running, starting instead..."
            fi
            start_backend
            ;;
        all)
            info "Restarting all services..."
            # Smart restart: only stop what's running
            local was_backend_running=$(is_service_running "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT" && echo "yes" || echo "no")
            local was_frontend_running=$(is_service_running "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT" && echo "yes" || echo "no")
            
            [ "$was_backend_running" = "yes" ] && stop_service "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT" && sleep 2
            [ "$was_frontend_running" = "yes" ] && stop_service "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT" && sleep 1
            
            start_all
            ;;
    esac
}

view_logs() {
    local service=$1
    local lines=${2:-50}
    
    case "$service" in
        frontend|f) tail -f -n "$lines" "$FRONTEND_LOG" ;;
        backend|b)  tail -f -n "$lines" "$BACKEND_LOG" ;;
        all)        tail -f -n "$lines" "$FRONTEND_LOG" "$BACKEND_LOG" ;;
        *)          error "Unknown log target: $service"; exit 1 ;;
    esac
}

show_status() {
    info "Service Status Report"
    echo "========================"
    
    local any_running=0
    
    # Frontend status
    echo -n "Frontend: "
    if [ -f "$FRONTEND_PID_FILE" ]; then
        local pid=$(get_pid_from_file "$FRONTEND_PID_FILE")
        if is_process_alive "$pid"; then
            success "RUNNING (PID: $pid)"
            echo "  Port: $FRONTEND_PORT"
            echo "  Log: $FRONTEND_LOG"
            any_running=1
        else
            warn "STALE PID (removing)"
            rm -f "$FRONTEND_PID_FILE"
        fi
    else
        warn "NOT RUNNING"
        is_port_listening "$FRONTEND_PORT" && warn "  BUT PORT $FRONTEND_PORT IS LISTENING!"
    fi
    
    # Backend status
    echo -n "Backend: "
    if [ -f "$BACKEND_PID_FILE" ]; then
        local pid=$(get_pid_from_file "$BACKEND_PID_FILE")
        if is_process_alive "$pid"; then
            success "RUNNING (PID: $pid)"
            echo "  Port: $BACKEND_PORT"
            echo "  Log: $BACKEND_LOG"
            any_running=1
        else
            warn "STALE PID (removing)"
            rm -f "$BACKEND_PID_FILE"
        fi
    else
        warn "NOT RUNNING"
        is_port_listening "$BACKEND_PORT" && warn "  BUT PORT $BACKEND_PORT IS LISTENING!"
    fi
    
    [ $any_running -eq 0 ] && { echo; warn "No services running"; }
}

# ==================== MAIN ====================
show_help() {
    cat << EOF
CryoET Tilt Series Viewer - Smart Service Management

Usage: $0 [COMMAND] [SERVICE] [OPTIONS]

Commands:
  start [frontend|backend|all]   Start services (idempotent)
  stop [frontend|backend|all]    Stop services (only if running)
  restart [frontend|backend|all] Smart restart (stop if running, then start)
  status                         Show service status
  logs [frontend|backend|all]    View logs
  help                           Show this help

Smart Features:
  - start: Skips already-running services
  - stop: Only acts on running services  
  - restart: Starts if not running, restarts if running
  - Dependencies auto-installed on first run
  - Virtual environment auto-managed

Examples:
  $0 start              # Start all services (smart)
  $0 restart backend    # Restart backend (or start if not running)
  $0 stop all           # Stop all running services
  $0 logs backend 100   # Show last 100 lines of backend log

Environment:
  FRONTEND_PORT, BACKEND_PORT - Set custom ports
EOF
}

main() {
    [ $# -eq 0 ] && { show_help; exit 0; }
    
    local command=$1
    shift || true
    
    # Cleanup stale PIDs for relevant commands
    case "$command" in
        start|restart|logs|status) cleanup_all_stale_pids ;;
    esac
    
    case "$command" in
        start)
            local service=${1:-all}
            case "$service" in
                frontend|f) start_frontend ;;
                backend|b)  start_backend ;;
                all)        start_all ;;
                *)          error "Unknown service: $service"; show_help; exit 1 ;;
            esac ;;
            
        stop)
            local service=${1:-all}
            case "$service" in
                frontend|f) stop_service "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT" ;;
                backend|b)  stop_service "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT" ;;
                all)        stop_all ;;
                *)          error "Unknown service: $service"; show_help; exit 1 ;;
            esac ;;
            
        restart)
            local service=${1:-all}
            restart_service "$service" ;;
            
        status)
            show_status ;;
            
        logs)
            local service=${1:-all}
            local lines=${2:-50}
            view_logs "$service" "$lines" ;;
            
        help|--help|-h)
            show_help ;;
            
        *)
            error "Unknown command: $command"
            show_help
            exit 1 ;;
    esac
}

# Execute main
trap 'log WARN "Interrupted"; exit 130' INT TERM
main "$@"