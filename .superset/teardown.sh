#!/usr/bin/env bash
# Runs when Superset deletes a workspace: stop this workspace's dev server and
# release its port reservation.
set -uo pipefail

WS="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
cd "$WS" || exit 0

port="$(grep -lxF "$WS" "$HOME/.superset/port-allocations/wtw"/* 2>/dev/null | head -1 | xargs -r basename)"
if [ -n "$port" ]; then
  # Only kill listeners running from this workspace, never another one's.
  for pid in $(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    case "$cwd" in "$WS"*) kill "$pid" 2>/dev/null && echo "[teardown] stopped dev server (pid $pid, port $port)";; esac
  done
fi

./.superset/port.sh --release
