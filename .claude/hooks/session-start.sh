#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Why this exists:
# A web session starts from a fresh clone with no node_modules, so `npm run
# type-check`, `npm run lint` and `npm test` all fail until dependencies are
# installed. This installs them once per container so the session can run the
# same three checks CI runs (.github/workflows/ci.yml) before pushing.
#
# Local (VS Code / terminal) sessions are left alone — you manage node_modules
# yourself there.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] node $(node --version), npm $(npm --version)"

# Idempotent: skip the install when node_modules already matches the lockfile
# (the container state is cached between sessions, so this is the common case).
if [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "[session-start] node_modules up to date with package-lock.json — skipping install"
else
  # `ci` not `install`: same reason as ci.yml — respect package-lock.json exactly.
  echo "[session-start] installing dependencies (npm ci)…"
  npm ci --no-audit --no-fund
fi

# Vitest, --env-file and next-pwa all need Node >= 20 (see .nvmrc / engines).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[session-start] WARNING: Node $NODE_MAJOR < 20 — vitest and --env-file will not run" >&2
fi

echo "[session-start] ready: npm run type-check · npm run lint · npm test"
