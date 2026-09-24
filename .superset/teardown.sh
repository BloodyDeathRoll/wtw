#!/usr/bin/env bash
# Runs when Superset deletes a workspace: stop the dev server started by
# run.sh and release this workspace's port reservation.
set -uo pipefail

WS="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
[ -d "$WS" ] || exit 0
cd "$WS"

# Every descendant of a PID (npm → sh → next dev → next-server, postcss…).
tree() { local c; for c in $(pgrep -P "$1"); do tree "$c"; done; echo "$1"; }

pidfile="$(git rev-parse --git-path superset-dev.pid 2>/dev/null)"
pid="$(cat "$pidfile" 2>/dev/null || true)"
# Only if that PID is still alive and still running in this workspace (PIDs get reused).
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null \
   && lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qxF "n$WS"; then
  pids="$(tree "$pid")"
  kill $pids 2>/dev/null
  # SIGTERM first; SIGKILL whatever is still up after 5s.
  alive() { local p; for p in $pids; do kill -0 "$p" 2>/dev/null && return 0; done; return 1; }
  for _ in 1 2 3 4 5; do alive || break; sleep 1; done
  kill -9 $pids 2>/dev/null
  echo "[teardown] stopped dev server (pid $pid)"
fi
rm -f "$pidfile"

./.superset/port.sh --release
