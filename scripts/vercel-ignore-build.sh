#!/usr/bin/env bash
# Vercel "Ignored Build Step" gate — wired via `ignoreCommand` in vercel.json.
#
# Only commits authored by an allowed GitHub user (the repo admin) are permitted
# to deploy. Everyone else's commits are skipped, so teammates' work-in-progress
# pushes/PRs no longer trigger failing preview or production builds.
#
# Vercel exit-code contract for the ignore step:
#   exit 1  → continue the build (deploy)
#   exit 0  → ignore the build (skip)
#
# Vercel exposes the commit author as VERCEL_GIT_COMMIT_AUTHOR_LOGIN.
# https://vercel.com/docs/project-configuration/vercel-json

set -uo pipefail

# Comma-separated GitHub login(s) allowed to deploy. Override in the Vercel
# project (Settings → Environment Variables → ALLOWED_DEPLOY_LOGINS) to add a
# teammate later without editing this file.
ALLOWED="${ALLOWED_DEPLOY_LOGINS:-BloodyDeathRoll}"
AUTHOR="${VERCEL_GIT_COMMIT_AUTHOR_LOGIN:-}"

echo "vercel-ignore-build: author='${AUTHOR:-<unknown>}' ref='${VERCEL_GIT_COMMIT_REF:-<unknown>}' allowed='${ALLOWED}'"

# Fail closed: if we can't identify the author, do not deploy.
if [ -z "$AUTHOR" ]; then
  echo "🛑 No commit author login available — skipping deployment."
  exit 0
fi

IFS=','
for login in $ALLOWED; do
  login="$(echo "$login" | xargs)"   # trim whitespace
  if [ "$AUTHOR" = "$login" ]; then
    echo "✅ '$AUTHOR' is an allowed deployer — proceeding with build."
    exit 1
  fi
done

echo "🛑 '$AUTHOR' is not an allowed deployer — skipping deployment."
exit 0
