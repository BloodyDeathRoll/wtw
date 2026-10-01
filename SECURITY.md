# Security

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repo), or contact the
maintainer directly. Expect an acknowledgement within a few days.

## What matters here

- **Taste profiles** (`users.dna`, snapshots, embeddings) are private,
  written-out descriptions of a person's preferences. One user must never be
  able to read another's.
- **Conversation transcripts.**
- **Provider keys and quota**: Groq, Mistral, Gemini, TMDB, OMDB, Upstash, the
  Supabase service role, and the Vercel deploy hook. Free-tier quota is the
  thing an attacker can most easily burn.

## How it is protected

- Every route handler under `src/app/api` checks the Supabase session cookie.
  Admin and cron routes instead check `Authorization: Bearer <CRON_SECRET>` in
  constant time (`src/lib/auth-guard.ts`). Every 401 is logged as `[auth] 401 <route>`.
- Row-level security is on every table for the anon-key path. The service-role
  client is used only on the server.
- Routes that cost LLM quota are rate-limited (`src/lib/rate-limit.ts`). The
  limiter fails closed.
- Co-watch: room membership is the only way to read another user's taste, and
  joining is rate-limited.
- Response headers are set in `next.config.ts`. A Content-Security-Policy runs
  report-only from `src/middleware.ts`, and violations are logged by
  `/api/csp-report`.
- GitHub Actions are pinned by SHA with least-privilege tokens. Dependabot runs
  with a 7-day cooldown, and an OSV scan runs weekly.

The last full audit was on 2026-09-11 (kept outside this repo, in swarm `audits/wtw/`).
