#!/usr/bin/env bash
# Superset Run button: start the dev server on this workspace's port.
# Records its PID so teardown stops exactly this server and nothing else.
set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-$(git rev-parse --show-toplevel)}"
PORT="$(./.superset/port.sh)"
# A server from an earlier run would hold the port; stop it first.
./.superset/stop.sh
# Inside the worktree's own git dir: per-workspace and never shows in git status.
echo $$ > "$(git rev-parse --git-path superset-dev.pid)"
echo "dev server → http://localhost:$PORT"
PORT="$PORT" exec npm run dev
