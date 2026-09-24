#!/usr/bin/env bash
# Runs when Superset creates a workspace: copy untracked config from the main
# checkout, install dependencies, reserve a dev-server port.
set -euo pipefail

ROOT="${SUPERSET_ROOT_PATH:?SUPERSET_ROOT_PATH not set}"
WS="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
cd "$WS"

# Untracked files a fresh worktree needs. Never overwrite what's already there.
if [ "$ROOT" != "$WS" ]; then
  for f in .env.local .vercel; do
    if [ -e "$ROOT/$f" ] && [ ! -e "$f" ]; then
      cp -R "$ROOT/$f" "$f"
      echo "[setup] copied $f"
    fi
  done
fi
[ -f .env.local ] || echo "[setup] WARNING: no .env.local — dev server needs the keys (see .env.local.example)" >&2

# Skip the install when node_modules already matches the lockfile.
if [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "[setup] node_modules up to date"
else
  npm ci --no-audit --no-fund
fi

echo "[setup] dev server port: $(./.superset/port.sh)"
