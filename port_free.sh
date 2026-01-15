#!/bin/bash

# Linux专属端口释放脚本
# 查找并终止占用指定端口的进程(支持多个端口)

# 默认端口列表(空格分隔)
DEFAULT_PORTS="8000 5173"
PORTS=${*:-$DEFAULT_PORTS}
FORCE=${FORCE:-false}  # 可通过环境变量设置强制模式

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# 检测占用端口的PID
get_pid() {
    local port=$1
    if command -v lsof &> /dev/null; then
        lsof -ti :${port} -sTCP:LISTEN 2>/dev/null
    else
        ss -tuln -p | grep -w ":${port}" | grep -oP 'pid=\K\d+' | head -1
    fi
}

# 终止单个端口
kill_port() {
    local port=$1
    local pid=$(get_pid $port)
    
    [ -z "$pid" ] && { log_success "端口 $port 空闲"; return 0; }
    
    # 获取进程信息
    local info=$(ps -p $pid -o user=,pid=,command= 2>/dev/null)
    [ -z "$info" ] && { log_error "无法获取端口 $port 进程信息"; return 1; }
    
    echo "----------------------------------------"
    log_info "端口 $port 被占用:"
    echo "  $info"
    echo "----------------------------------------"
    
    # 权限检查
    local SUDO=""
    if [ "$EUID" -ne 0 ] && [ "$(echo $info | awk '{print $1}')" != "$(whoami)" ]; then
        log_warning "需要sudo权限"
        SUDO="sudo"
    fi
    
    # 终止进程
    if [ "$FORCE" = "true" ]; then
        log_warning "强制终止 PID:$pid"
        $SUDO kill -TERM $pid
    else
        read -p "终止此进程? [y/N] " -n 1 -r
        echo
        [[ $REPLY =~ ^[Yy]$ ]] || { log_info "跳过"; return 0; }
        $SUDO kill -TERM $pid
    fi
    
    # 验证
    sleep 0.3
    if kill -0 $pid 2>/dev/null; then
        log_warning "强制杀死 PID:$pid"
        $SUDO kill -KILL $pid
    fi
    
    log_success "端口 $port 已释放"
}

# 主逻辑
log_info "检查端口: $PORTS"

for port in $PORTS; do
    kill_port $port
done

log_info "所有操作完成"