#!/usr/bin/env bash
# Runs when Superset deletes a workspace: stop the dev server started by the
# run command and release this workspace's port reservation.
set -uo pipefail

WS="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
[ -d "$WS" ] || exit 0
# Run from / so this script's own subshells never match the cwd check below.
cd /

# `npm run dev` spawns a tree (npm → sh → next dev → next-server, postcss…)
# whose process names vary, so stop every process whose cwd is inside this
# workspace, sparing this script's own ancestors. Other workspaces' servers
# live in other directories and are never touched.
keep=" $$ "; p=$$
while p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" && [ -n "$p" ] && [ "$p" != 0 ]; do keep="$keep$p "; done
pids="$(lsof -a -d cwd -Fpn 2>/dev/null | awk -v ws="$WS" -v keep="$keep" '
  /^p/ { pid = substr($0, 2) }
  /^n/ { d = substr($0, 2); if ((d == ws || index(d, ws "/") == 1) && index(keep, " " pid " ") == 0) print pid }')"
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null
  echo "[teardown] stopped workspace processes: $(echo $pids)"
fi

"$WS/.superset/port.sh" --release
