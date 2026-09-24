#!/usr/bin/env bash
# Stop this workspace's dev server (the one run.sh recorded), and nothing else.
# Used by teardown.sh, and by run.sh so a re-run never orphans an old server.
set -uo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-$(git rev-parse --show-toplevel)}"
# Physical path: lsof reports cwd with symlinks resolved (e.g. macOS /tmp → /private/tmp).
WS="$(pwd -P)"
pidfile="$(git rev-parse --git-path superset-dev.pid)"
pid="$(cat "$pidfile" 2>/dev/null || true)"
[ -n "$pid" ] || exit 0

# Already gone: just clear the record.
if ! kill -0 "$pid" 2>/dev/null; then rm -f "$pidfile"; exit 0; fi

# PIDs get reused: only act if that process is still running in this workspace.
# Otherwise keep the pidfile so nothing is lost.
if ! lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qxF "n$WS"; then
  echo "[stop] pid $pid is not running in $WS — leaving it alone" >&2
  exit 0
fi

# Every descendant of a PID (npm → sh → next dev → next-server, postcss…).
tree() { local c; for c in $(pgrep -P "$1"); do tree "$c"; done; echo "$1"; }
pids="$(tree "$pid")"
kill $pids 2>/dev/null
# SIGTERM first; SIGKILL whatever is still up after 5s.
alive() { local p; for p in $pids; do kill -0 "$p" 2>/dev/null && return 0; done; return 1; }
for _ in 1 2 3 4 5; do alive || break; sleep 1; done
kill -9 $pids 2>/dev/null
rm -f "$pidfile"
echo "[stop] stopped dev server (pid $pid)"
