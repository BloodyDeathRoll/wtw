#!/usr/bin/env bash
# Runs when Superset deletes a workspace: stop the dev server started by
# run.sh and release this workspace's port reservation.
set -uo pipefail

WS="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
[ -d "$WS" ] || exit 0
cd "$WS"

./.superset/stop.sh
./.superset/port.sh --release
