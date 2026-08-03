# WTW — What To Watch

WTW is an AI-powered film and TV recommendation engine that builds a continuously evolving viewer fingerprint — modeling affinity for specific directors, writers, and actors, narrative preferences, and taste at a deeper level than any existing platform — to deliver personalized, explainable recommendations that get smarter every time you use it.

**GitHub:** https://github.com/BloodyDeathRoll/wtw.git

## Where the detail lives — read the doc for the area you're touching

| Working on | Read first |
|---|---|
| **Anything — start here.** What's done, what's next, who drives it | `docs/INTEGRATION.md` |
| `src/types/dna.ts`, `src/modules/dna/`, any cross-module seam | `docs/DNA-CONTRACT.md` |
| Full DNA field reference | `docs/master_dna_schema.json` |
| Git workflow, branching, PRs, merge conflicts | `GITGUIDE.md` |
| "What did each module already ship?" | `docs/SHIPPED.md` (history, not a to-do list) |
| Watchlist feature · trailer/RecCard · costs · team split | `docs/watchlist-plan.md` · `docs/trailer-reccard-handoff.md` · `docs/future-costs.md` · `docs/team-assignments.md` |

## Ownership — three assignments, one repo

A1 = Session Brain · A2 = Recommendation Engine · A3 = DNA Schema Writer

| Path | Owner | Rule |
|---|---|---|
| `src/types/dna.ts` | Everyone | ⚠️ SHARED CONTRACT — all three must approve any change |
| `src/modules/session/` | A1 | Others do not modify |
| `src/modules/engine/` | A2 | Others do not modify |
| `src/modules/dna/` | A3 | Others do not modify |
| `src/app/` | Shared | Coordinate before touching — one person at a time |
| `src/lib/` | Shared | First person who needs a utility builds it |

Cut a short-lived branch off `main` per task, named by the work (`feat/…`, `fix/…`, `test/…`, `chore/…`) — see `GITGUIDE.md`. The per-assignment `feature/*` branches are merged and retired.

## Standing rules
Each was decided or learned the hard way. **Do not re-litigate from first principles — read the linked doc.**

- **Never overwrite the full DNA schema** — always merge/patch specific fields. (`docs/DNA-CONTRACT.md`)
- **Always increment `metadata.taste_version` + `last_updated` after any DNA write.** (`docs/DNA-CONTRACT.md`)
- **`learning_loop.open_questions` is append-only during a session** — only the DNA Writer resolves them. (`docs/DNA-CONTRACT.md`)
- **Model IDs live only in `src/lib/ai-models.ts`** — never hardcode one in a module.
- **Groq gpt-oss/qwen are reasoning models and break `generateObject`** (empty `content`). Mistral chat on the embeddings key is the enrichment workhorse; Gemini free is ~20 req/**day**. (`docs/INTEGRATION.md` §0)
- **Never commit `.env.local`.**

## Do not touch
These decisions are made. Do not refactor, rename, or redesign without team agreement.
- `src/types/dna.ts` field names and types
- The 3-branch structure
- The Supabase + pgvector + Upstash Redis stack
- The Vercel AI SDK as the orchestration layer (do not swap in LangChain)
- TMDB as the primary content metadata source

## Key product decisions (do not re-debate these)
- **No forms, no surveys** — onboarding and sessions are conversational
- **Dual rating track** — quick 1–5 flip (high volume) AND deep 12-dimension survey (opt-in, low volume)
- **Stretch picks** — 1 in every 20 recommendations is intentionally outside the fingerprint. Suppressed until 15 signals exist.
- **Anti-recommendation** — stretch pick accept/reject is itself a fingerprint signal
- **Creative lineage graph** — system models director/writer influence chains, not just direct crew matches
- **Regret signal** — 48hr post-watch prompt: glad / neutral / regret. Separate fingerprint dimension.
- **Co-watch room** — 4-digit room code (not Bluetooth), real-time fingerprint intersection
- **Explainability** — every recommendation has a "Why this?" button with positive AND negative signals
- **PWA first** — no native app at MVP
- **Temporal decay** — ratings older than 18 months weighted at 50%
- **Fingerprint versioning** — last 5 snapshots stored for rollback and explanation

## Tech stack
| Layer | Technology |
|---|---|
| Framework | Next.js 15, App Router, TypeScript |
| UI | Tailwind CSS + shadcn/ui + Radix UI |
| Motion | Framer Motion |
| PWA | next-pwa |
| Auth | Supabase Auth (email + Google OAuth) |
| Database | Supabase — Postgres + pgvector extension |
| Cache | Upstash Redis (free tier) |
| AI Orchestration | Vercel AI SDK |
| LLM — speed (text) | Groq / `openai/gpt-oss-120b` (free tier) |
| LLM — voice (audio↔audio) | Gemini Live 2.5 Flash (native audio-to-audio) |
| LLM — embeddings | Mistral embed (free tier) |
| Content metadata | TMDB API (free) |
| Ratings supplement | OMDB API (free tier) |

## Environment
`.env.local`, never committed. `CRON_SECRET` is shared across all three team members.
```
NEXT_PUBLIC_SUPABASE_URL=          GROQ_API_KEY=            TMDB_API_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=     GEMINI_API_KEY=          OMDB_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=         MISTRAL_API_KEY=         CRON_SECRET=
UPSTASH_REDIS_REST_URL=            UPSTASH_REDIS_REST_TOKEN=
```

## Commands
```bash
npm install            # first time
npm run dev            # dev server
npm run type-check     # must be clean before a PR
git pull origin main   # sync before starting
```

## Doc precedence
CLAUDE.md and `src/types/dna.ts` are authoritative. The area docs above are current spec. `docs/SHIPPED.md` is history. **When docs disagree, stop and reconcile before implementing.**

At the end of every session, update `docs/INTEGRATION.md` — tick off what landed, note what you found.
