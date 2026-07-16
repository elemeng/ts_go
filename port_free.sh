#!/bin/bash
# Scan ports in a range: report taken ports and find the first free one
# Usage: ./port_free.sh [start_port] [end_port]
#   Default: 8088 9000
#   Prints taken ports to stderr, prints the first free port to stdout.

set -euo pipefail

START="${1:-8088}"
END="${2:-9000}"

# Get all listening ports in one shot
LISTENING_PORTS=$(ss -tlnp 2>/dev/null | grep -oP ':\K\d+' | sort -nu)

TAKEN=()
FREE=""

for port in $(seq "$START" "$END"); do
    if echo "$LISTENING_PORTS" | grep -qx "$port"; then
        TAKEN+=("$port")
    elif [ -z "$FREE" ]; then
        FREE="$port"
    fi
done

# Report taken ports
if [ ${#TAKEN[@]} -gt 0 ]; then
    echo "Taken ports in range ${START}-${END}:" >&2
    printf "  %-5s  %-8s  %s\n" "Port" "PID" "Process" >&2
    for p in "${TAKEN[@]}"; do
        line=$(ss -tlnp 2>/dev/null | grep ":${p} ")
        proc=$(echo "$line" | sed 's/.*users:((//; s/,.*//; s/"//g' | head -1)
        pid=$(echo "$line" | sed 's/.*,pid=//; s/,.*//' | head -1)
        printf "  %-5s  %-8s  %s\n" "$p" "$pid" "$proc" >&2
    done
else
    echo "No ports taken in range ${START}-${END}." >&2
fi

# Print first free port
if [ -n "$FREE" ]; then
    echo "$FREE"
else
    echo "No free port found in range $START-$END" >&2
    exit 1
fi
