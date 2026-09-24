#!/usr/bin/env bash
# Prints this workspace's dev-server port, reserving one on first call.
# Parallel workspaces would all grab 3000, so each gets its own port from
# 3001-3099 (3000 is left for a plain `npm run dev` outside Superset).
# Reservations are files in a registry shared by every wtw workspace:
#   ~/.superset/port-allocations/wtw/<port>  → contains the workspace path
# `port.sh --release` drops this workspace's reservation (used by teardown).
set -euo pipefail

WS="${SUPERSET_WORKSPACE_PATH:-$(git rev-parse --show-toplevel)}"
REG="$HOME/.superset/port-allocations/wtw"
mkdir -p "$REG"

existing="$(grep -lxF "$WS" "$REG"/* 2>/dev/null | head -1 || true)"

if [ "${1:-}" = "--release" ]; then
  [ -n "$existing" ] && rm -f "$existing"
  exit 0
fi

if [ -n "$existing" ]; then
  basename "$existing"
  exit 0
fi

for port in $(seq 3001 3099); do
  f="$REG/$port"
  # Reclaim a reservation whose workspace was deleted without teardown.
  if [ -f "$f" ] && [ ! -d "$(cat "$f")" ]; then rm -f "$f"; fi
  [ -f "$f" ] && continue
  lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1 && continue
  # noclobber makes the claim atomic if two setups race for the same port.
  if (set -o noclobber; echo "$WS" > "$f") 2>/dev/null; then
    echo "$port"
    exit 0
  fi
done

echo "port.sh: no free port in 3001-3099" >&2
exit 1
