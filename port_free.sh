#!/bin/bash
# Find a free TCP port in a given range
# Usage: ./port_free.sh [start_port] [end_port]
#   Default: 8088 9000
#   Prints the first free port found, or exits 1 if none available.

set -euo pipefail

START="${1:-8088}"
END="${2:-9000}"

for port in $(seq "$START" "$END"); do
    if ! ss -tlnp "sport = :$port" 2>/dev/null | grep -q .; then
        if ! lsof -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
            echo "$port"
            exit 0
        fi
    fi
done

echo "No free port found in range $START-$END" >&2
echo "Check firewall: firewall-cmd --list-ports" >&2
echo "Check used ports: ss -tlnp" >&2
exit 1
