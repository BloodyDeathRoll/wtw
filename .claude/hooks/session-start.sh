#!/bin/bash
# SessionStart hook for every Claude Code session in this repo.
#
# Why this exists:
# A web session starts from a fresh clone with no node_modules, so `npm run
# type-check`, `npm run lint` and `npm test` all fail until dependencies are
# installed. This installs them once per container so the session can run the
# same three checks CI runs (.github/workflows/ci.yml) before pushing.
#
# Local (VS Code / terminal) sessions only get the main pull below — you manage
# node_modules yourself there.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Hook stdout must be the JSON below and nothing else, so every log line goes to
# stderr; fd 3 keeps the real stdout for the JSON.
exec 3>&1 1>&2

# ── Pull main, every session (local and web) ───────────────────────────────
# Start from the latest main. Skipped on a dirty tree, a failed fetch, a
# diverged local main or a conflicting merge (aborted). Never fails the session,
# but a skip is NOT silent: it is shown to the user and Claude is told to raise
# it before anything else.
PULL_SKIPPED=""
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  PULL_SKIPPED="uncommitted changes on $BRANCH"
elif ! timeout 30 git fetch -q origin main; then
  PULL_SKIPPED="could not fetch origin/main"
elif [ "$BRANCH" = "main" ]; then
  if git merge -q --ff-only origin/main; then
    echo "[session-start] main is up to date with origin/main"
  else
    PULL_SKIPPED="local main has diverged from origin/main"
  fi
elif git merge -q --no-edit origin/main; then
  echo "[session-start] merged origin/main into $BRANCH"
else
  git merge --abort || true
  PULL_SKIPPED="origin/main conflicts with $BRANCH (merge aborted)"
fi

emit_result() {
  [ -n "$PULL_SKIPPED" ] || return 0
  PULL_SKIPPED="$PULL_SKIPPED" node -e '
    const why = process.env.PULL_SKIPPED
    const msg = `main was NOT pulled this session: ${why}. You may be working on stale code.`
    console.log(JSON.stringify({
      systemMessage: `⚠️ ${msg}`,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `${msg} Before doing anything else, start your first reply by telling the user this in one line and ask them to confirm they have read it. Do not start the task until they confirm.`,
      },
    }))' >&3
}
trap emit_result EXIT

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

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
