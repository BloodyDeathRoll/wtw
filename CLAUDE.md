# WTW — What To Watch
## Claude Code Master Context File

> Read this file at the start of every session before writing a single line of code.
> Update the "Current Status" section before ending every session.

---

## Project in one line

WTW is an AI-powered film and TV recommendation engine that builds a continuously evolving viewer fingerprint — modeling affinity for specific directors, writers, and actors, narrative preferences, and taste at a deeper level than any existing platform — to deliver personalized, explainable recommendations that get smarter every time you use it.

---

## Repository

**GitHub:** https://github.com/BloodyDeathRoll/wtw.git

---

## Tech Stack

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
| LLM — speed | Groq / Llama 3.3 70B (free tier) |
| LLM — embeddings | Mistral embed (free tier) |
| Content metadata | TMDB API (free) |
| Ratings supplement | OMDB API (free tier) |

---

## Folder Structure & Ownership

```
wtw/
├── CLAUDE.md                        ← YOU ARE HERE. Read first, update before closing.
├── GITGUIDE.md                      ← Simple git instructions for all collaborators
├── docs/
│   └── master_dna_schema.json       ← Shared DNA contract. Read-only reference.
├── src/
│   ├── types/
│   │   └── dna.ts                   ← ⚠️ SHARED CONTRACT. Never modify alone.
│   ├── modules/
│   │   ├── session/                 ← 🔵 ASSIGNMENT 1 — Session Brain
│   │   ├── engine/                  ← 🟣 ASSIGNMENT 2 — Recommendation Engine
│   │   └── dna/                     ← 🟠 ASSIGNMENT 3 — DNA Schema Writer
│   ├── app/                         ← Next.js App Router (shared, coordinate before touching)
│   └── lib/                         ← Supabase client, Redis, shared utils (shared)
```

### Who owns what

| Path | Owner | Rule |
|---|---|---|
| `src/types/dna.ts` | Everyone | All three must approve any change |
| `src/modules/session/` | Assignment 1 | Others do not modify |
| `src/modules/engine/` | Assignment 2 | Others do not modify |
| `src/modules/dna/` | Assignment 3 | Others do not modify |
| `src/app/` | Shared | Coordinate before touching — one person at a time |
| `src/lib/` | Shared | First person who needs a utility builds it |

---

## The DNA Schema — The Shared Contract

Every module reads from or writes to this structure. Field names and types are fixed.
Full reference: `docs/master_dna_schema.json`

**Critical rules:**
- Never overwrite the full schema — always merge/patch specific fields
- Always increment `metadata.taste_version` and update `metadata.last_updated` after any write
- Confidence values increase when corroborated, decrease when contradicted
- `learning_loop.open_questions` is append-only during a session — the DNA Writer resolves them
- The schema lives in Supabase as a JSONB column on the `users` table

**Top-level structure:**
```typescript
{
  metadata:               // user_id, schema_version, taste_version, last_updated, total_sessions
  strand_a_creative_affinity:   // directors, writers, cinematographers, actors (score + confidence)
  strand_b_narrative_dimensions: // moral_ambiguity, narrative_complexity, emotional_demand, etc.
  strand_c_visceral_specs:       // pacing_weights, tone_weights, aspect_weights
  contextual_logic:              // exclusion_rules, soft_preferences, temporal_modifiers
  signals:                       // everything watched + reactions (the raw history)
  learning_loop:                 // open_questions, stretch_pick_history, recommendation_history
}
```

---

## Branch Names

| Assignment | Branch |
|---|---|
| Assignment 1 — Session Brain | `feature/session-brain` |
| Assignment 2 — Recommendation Engine | `feature/rec-engine` |
| Assignment 3 — DNA Schema Writer | `feature/dna-writer` |
| Shared foundation | `main` |

---

## Interfaces Between Modules

These are the exact types that connect the three modules.
Full definitions live in `src/types/dna.ts`.

### SessionSummary
Produced by Assignment 1 → consumed by Assignment 3 after every session.
```typescript
interface SessionSummary {
  session_number: number
  new_signals: DNASignal[]
  dimension_updates: Partial<StrandB>
  open_questions_resolved: string[]
  new_open_questions: string[]
  recommendation_made: string | null
  recommendation_accepted: boolean | null
}
```

### SessionContext
Produced by Assignment 1 → consumed by Assignment 2 to personalise the feed.
```typescript
interface SessionContext {
  current_mood_signal: string | null
  immediate_request: string | null
  session_override_active: boolean
}
```

### RecommendationResult
Produced by Assignment 2 → consumed by Assignment 1 (display) and Assignment 3 (feedback).
```typescript
interface RecommendationResult {
  title: string
  tmdb_id: string
  type: 'movie' | 'tv'
  composite_score: number
  reason_payload: ReasonPayload
  explanation: string
  is_stretch_pick: boolean
  generated_at: string
  fingerprint_version: number
}
```

---

## Key Product Decisions (do not re-debate these)

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

---

## APIs & Environment Variables

All three sessions need these in `.env.local`. Never commit this file.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=
TMDB_API_KEY=
OMDB_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

---

## Current Status

> ⬇️ UPDATE THIS SECTION AT THE END OF EVERY SESSION

### Assignment 1 — Session Brain
**Branch:** `feature/session-brain`
**Last updated:** —
**Completed:**
- [ ] Nothing yet

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] —

---

### Assignment 2 — Recommendation Engine
**Branch:** `feature/rec-engine`
**Last updated:** —
**Completed:**
- [ ] Nothing yet

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] —

---

### Assignment 3 — DNA Schema Writer
**Branch:** `feature/dna-writer`
**Last updated:** 2026-05-27
**Completed:**
- [x] `src/modules/dna/init.ts` — `buildEmptyDNA(userId)` factory for new users
- [x] `src/modules/dna/signal-merger.ts` — append signals, contradiction detection, dedup
- [x] `src/modules/dna/temporal-decay.ts` — 18-month decay, 30-day run guard
- [x] `src/modules/dna/strand-a-updater.ts` — crew affinity scores + lineage boost (pure)
- [x] `src/modules/dna/strand-b-updater.ts` — narrative dimensions + Groq notes regeneration
- [x] `src/modules/dna/strand-c-updater.ts` — pacing/tone/aspect weights + aspect survey path
- [x] `src/modules/dna/learning-loop.ts` — open questions, recommendation & stretch pick history
- [x] `src/modules/dna/tmdb.ts` — TMDB credits resolution (feeds Strand A)
- [x] `src/modules/dna/embedding.ts` — Mistral embed → pgvector upsert
- [x] `src/modules/dna/snapshot.ts` — versioned snapshots, keep-last-5, rollback
- [x] `src/modules/dna/reader.ts` — `readDNA` with Upstash Redis cache + cache invalidation
- [x] `src/modules/dna/writer.ts` — orchestrator: full write pipeline, `patchRegretSignal`
- [x] `src/modules/dna/index.ts` — public API re-exports for Assignments 1 & 2
- [x] `supabase/migrations/0002_dna_snapshots.sql` — `dna_snapshots` table + `fingerprint_embeddings` UNIQUE constraint

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] Integration testing: call `writeDNA` end-to-end with a mock `SessionSummary` against a live Supabase dev instance
- [ ] Confirm `fingerprint_embedding_ref` upsert format with Assignment 2

---

## Do Not Touch List

These decisions are made. Do not refactor, rename, or redesign without team agreement.

- `src/types/dna.ts` field names and types
- The 3-branch structure
- The Supabase + pgvector + Upstash Redis stack
- The Vercel AI SDK as the orchestration layer (do not swap in LangChain)
- TMDB as the primary content metadata source

---

## Useful Commands

```bash
# Install dependencies (first time)
npm install

# Run dev server
npm run dev

# Type check
npm run type-check

# Push your branch
git push origin feature/your-branch-name

# Sync with main before starting
git pull origin main
```
