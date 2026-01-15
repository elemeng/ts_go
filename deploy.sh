#!/bin/bash
# CryoET Tilt Series Viewer - 一键部署脚本
# 用于启动、停止、重启前后端服务

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# PID 文件
FRONTEND_PID_FILE="$PROJECT_ROOT/.frontend.pid"
BACKEND_PID_FILE="$PROJECT_ROOT/.backend.pid"

# 日志文件
FRONTEND_LOG="$PROJECT_ROOT/.frontend.log"
BACKEND_LOG="$PROJECT_ROOT/.backend.log"

# 端口
FRONTEND_PORT=5173
BACKEND_PORT=8000

# 打印带颜色的信息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查进程是否运行
is_process_running() {
    local pid_file=$1
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$pid_file"
            return 1
        fi
    fi
    return 1
}

# 检查端口是否被占用
is_port_in_use() {
    local port=$1
    if lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# 停止前端服务
stop_frontend() {
    print_info "停止前端服务..."
    
    if is_process_running "$FRONTEND_PID_FILE"; then
        local pid=$(cat "$FRONTEND_PID_FILE")
        kill "$pid"
        wait "$pid" 2>/dev/null || true
        rm -f "$FRONTEND_PID_FILE"
        print_success "前端服务已停止 (PID: $pid)"
    else
        print_warning "前端服务未运行"
    fi
}

# 停止后端服务
stop_backend() {
    print_info "停止后端服务..."
    
    if is_process_running "$BACKEND_PID_FILE"; then
        local pid=$(cat "$BACKEND_PID_FILE")
        kill "$pid"
        wait "$pid" 2>/dev/null || true
        rm -f "$BACKEND_PID_FILE"
        print_success "后端服务已停止 (PID: $pid)"
    else
        print_warning "后端服务未运行"
    fi
}

# 停止所有服务
stop_all() {
    print_info "停止所有服务..."
    stop_frontend
    stop_backend
    print_success "所有服务已停止"
}

# 启动前端服务
start_frontend() {
    print_info "启动前端服务..."
    
    # 检查端口
    if is_port_in_use "$FRONTEND_PORT"; then
        print_error "前端端口 $FRONTEND_PORT 已被占用"
        return 1
    fi
    
    # 检查依赖
    if [ ! -d "node_modules" ]; then
        print_info "安装前端依赖..."
        bun install
    fi
    
    # 启动前端
    nohup bun run dev > "$FRONTEND_LOG" 2>&1 &
    local pid=$!
    echo "$pid" > "$FRONTEND_PID_FILE"
    
    # 等待启动
    sleep 3
    
    if is_process_running "$FRONTEND_PID_FILE"; then
        print_success "前端服务已启动 (PID: $pid)"
        print_info "访问地址: http://localhost:$FRONTEND_PORT"
        print_info "日志文件: $FRONTEND_LOG"
    else
        print_error "前端服务启动失败"
        cat "$FRONTEND_LOG"
        return 1
    fi
}

# 启动后端服务
start_backend() {
    print_info "启动后端服务..."
    
    # 检查端口
    if is_port_in_use "$BACKEND_PORT"; then
        print_error "后端端口 $BACKEND_PORT 已被占用"
        return 1
    fi
    
    # 检查 Python 环境
    if ! command -v python3 &> /dev/null; then
        print_error "未找到 Python 3"
        return 1
    fi
    
    # 检查虚拟环境
    if [ ! -d ".venv" ]; then
        print_info "创建 Python 虚拟环境..."
        python3 -m venv .venv
    fi
    
    # 激活虚拟环境并安装依赖
    print_info "检查后端依赖..."
    source .venv/bin/activate
    
    if ! command -v uvicorn &> /dev/null; then
        print_info "安装后端依赖..."
        pip install -e backend/
    fi
    
    # 启动后端（从 backend 目录运行）
    cd backend
    nohup uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" > "../backend.log" 2>&1 &
    local pid=$!
    echo "$pid" > "../backend.pid"
    cd ..
    mv backend.pid "$BACKEND_PID_FILE"
    mv backend.log "$BACKEND_LOG"
    
    # 等待启动
    sleep 3
    
    if is_process_running "$BACKEND_PID_FILE"; then
        print_success "后端服务已启动 (PID: $pid)"
        print_info "API 地址: http://localhost:$BACKEND_PORT"
        print_info "API 文档: http://localhost:$BACKEND_PORT/docs"
        print_info "日志文件: $BACKEND_LOG"
    else
        print_error "后端服务启动失败"
        cat "$BACKEND_LOG"
        return 1
    fi
}

# 启动所有服务
start_all() {
    print_info "启动所有服务..."
    start_backend
    start_frontend
    print_success "所有服务已启动"
}

# 重启前端
restart_frontend() {
    print_info "重启前端服务..."
    stop_frontend
    sleep 1
    start_frontend
}

# 重启后端
restart_backend() {
    print_info "重启后端服务..."
    stop_backend
    sleep 1
    start_backend
}

# 重启所有服务
restart_all() {
    print_info "重启所有服务..."
    stop_all
    sleep 2
    start_all
}

# 查看状态
status() {
    print_info "服务状态:"
    echo ""
    
    # 前端状态
    if is_process_running "$FRONTEND_PID_FILE"; then
        local pid=$(cat "$FRONTEND_PID_FILE")
        print_success "前端服务: 运行中 (PID: $pid)"
        if is_port_in_use "$FRONTEND_PORT"; then
            print_info "  地址: http://localhost:$FRONTEND_PORT"
        fi
    else
        print_warning "前端服务: 未运行"
    fi
    
    # 后端状态
    if is_process_running "$BACKEND_PID_FILE"; then
        local pid=$(cat "$BACKEND_PID_FILE")
        print_success "后端服务: 运行中 (PID: $pid)"
        if is_port_in_use "$BACKEND_PORT"; then
            print_info "  地址: http://localhost:$BACKEND_PORT"
            print_info "  文档: http://localhost:$BACKEND_PORT/docs"
        fi
    else
        print_warning "后端服务: 未运行"
    fi
    
    echo ""
}

# 查看日志
logs() {
    local service=$1
    
    case $service in
        frontend|front|f)
            if [ -f "$FRONTEND_LOG" ]; then
                tail -f "$FRONTEND_LOG"
            else
                print_error "前端日志文件不存在"
            fi
            ;;
        backend|back|b)
            if [ -f "$BACKEND_LOG" ]; then
                tail -f "$BACKEND_LOG"
            else
                print_error "后端日志文件不存在"
            fi
            ;;
        all|a)
            print_info "显示所有日志 (Ctrl+C 退出)..."
            tail -f "$FRONTEND_LOG" "$BACKEND_LOG"
            ;;
        *)
            print_error "用法: $0 logs [frontend|backend|all]"
            exit 1
            ;;
    esac
}

# 显示帮助
show_help() {
    cat << EOF
CryoET Tilt Series Viewer - 部署脚本

用法: $0 [命令] [选项]

命令:
    start [service]     启动服务
                        service: frontend, backend, all (默认: all)
    
    stop [service]      停止服务
                        service: frontend, backend, all (默认: all)
    
    restart [service]   重启服务
                        service: frontend, backend, all (默认: all)
    
    status              查看服务状态
    
    logs [service]      查看服务日志
                        service: frontend, backend, all
    
    help                显示帮助信息

示例:
    $0 start            # 启动所有服务
    $0 start frontend   # 仅启动前端
    $0 stop backend     # 停止后端
    $0 restart all      # 重启所有服务
    $0 status           # 查看状态
    $0 logs backend     # 查看后端日志

EOF
}

# 主函数
main() {
    local command=$1
    local service=$2
    
    case $command in
        start)
            case $service in
                frontend|front|f)
                    start_frontend
                    ;;
                backend|back|b)
                    start_backend
                    ;;
                all|a|"")
                    start_all
                    ;;
                *)
                    print_error "Unknown service: $service"
                    show_help
                    exit 1
                    ;;
            esac
            ;;
        stop)
            case $service in
                frontend|front|f)
                    stop_frontend
                    ;;
                backend|back|b)
                    stop_backend
                    ;;
                all|a|"")
                    stop_all
                    ;;
                *)
                    print_error "Unknown service: $service"
                    show_help
                    exit 1
                    ;;
            esac
            ;;
        restart)
            case $service in
                frontend|front|f)
                    restart_frontend
                    ;;
                backend|back|b)
                    restart_backend
                    ;;
                all|a|"")
                    restart_all
                    ;;
                *)
                    print_error "Unknown service: $service"
                    show_help
                    exit 1
                    ;;
            esac
            ;;
        status)
            status
            ;;
        logs)
            logs "$service"
            ;;
        help|--help|-h)
            show_help
            ;;
        "")
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"