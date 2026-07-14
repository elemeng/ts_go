#!/bin/bash
# Find a free TCP port in a given range
# Usage: ./port_free.sh [start_port] [end_port]
#   Default: 8088 9000
#   Prints the first free port found, or exits 1 if none available.

set -euo pipefail

START="${1:-8088}"
END="${2:-9000}"

for port in $(seq "$START" "$END"); do
    # ss checks the kernel socket table; filter by :port followed by space/end-of-line
    # to avoid matching the header line or partial port numbers (e.g. 8088 matching 18088)
    if ! ss -tlnp 2>/dev/null | grep -Eq ":${port}\b"; then
        echo "$port"
        exit 0
    fi
done

echo "No free port found in range $START-$END" >&2
echo "Check used ports: ss -tlnp" >&2
exit 1
