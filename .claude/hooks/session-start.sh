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

# ── .env.local from the environment's variables ────────────────────────────
# The web environment injects keys as shell variables, but the repo's scripts
# run as `node --env-file=.env.local …` and read a FILE. Write one from whatever
# keys are set, so `npm run grow-catalog` & co. work unchanged. Never committed
# (.gitignore) and never overwritten if one already exists.
ENV_KEYS=(
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
  GROQ_API_KEY MISTRAL_API_KEY MISTRAL_BATCH_API_KEY GEMINI_API_KEY
  TMDB_API_KEY OMDB_API_KEY
  UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN
  CRON_SECRET VERCEL_DEPLOY_HOOK_URL
)
if [ -f .env.local ]; then
  echo "[session-start] .env.local already present — leaving it alone"
else
  written=0
  for k in "${ENV_KEYS[@]}"; do
    v="${!k:-}"
    [ -n "$v" ] || continue
    [ "$written" -eq 0 ] && : > .env.local && chmod 600 .env.local
    printf '%s=%s\n' "$k" "$v" >> .env.local
    written=$((written + 1))
  done
  if [ "$written" -gt 0 ]; then
    echo "[session-start] wrote .env.local with $written key(s) from the environment"
  else
    echo "[session-start] no WTW keys in the environment — .env.local not written (type-check/lint/test still work; dev server, scripts and E2E need the keys)"
  fi
fi

echo "[session-start] ready: npm run type-check · npm run lint · npm test"
