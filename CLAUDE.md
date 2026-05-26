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
| LLM — speed (text) | Groq / Llama 3.3 70B (free tier) |
| LLM — voice (audio↔audio) | Gemini Live 2.5 Flash (native audio-to-audio) |
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
GEMINI_API_KEY=          # voice mode (Gemini Live 2.5 Flash)
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
**Last updated:** 2026-05-26
**Completed:**
- [x] Module relocated to `src/modules/session/` (commit `21433dd`)
- [x] Design port from claude.ai/design handoff (WTWApp, particles, design tokens, layout)
- [x] Auth flow shipped end-to-end (Supabase Google OAuth via standard redirect):
  - `/login` rebuilt inside the WTW shell (`AppShell` shared with WTWApp), Google sign-in button
  - `/` auth-gated server-side, redirects to `/login` if no session, passes `AppUser` to WTWApp
  - User avatar + sign-out popover in TopBar (replaces the placeholder hamburger)
- [x] ESLint 9 flat config (`eslint.config.mjs`) with `next/core-web-vitals` + `next/typescript`; underscore-prefix unused-vars convention honoured
- [x] Text chat wired end-to-end: `WTWApp.tsx` consumes `/api/conversation/message` via AI SDK `useChat`; canned `aiResponseFor` stub deleted. System prompt rewritten as a calibration interview (one focused taste-revealing question per turn, no echoing the user's answer, hedged fallback if user asks for a rec early).
- [x] Voice mode shipped end-to-end via Gemini Live 2.5 Flash (native audio-to-audio):
  - `POST /api/voice/session` — auth-gated server route mints ephemeral Gemini Live token with locked model + system prompt + AUDIO modality. Model is `gemini-2.5-flash-native-audio-preview-12-2025` (the original `gemini-live-2.5-flash-preview` ID was retired on 2026-03-19).
  - `src/modules/session/voice/audio.ts` — `MicCapture` (16kHz int16 PCM ↔ base64) and `AudioPlayer` (24kHz playback, barge-in via `flush()`)
  - `src/modules/session/voice/VoiceMode.tsx` + `.module.css` — full-takeover screen: aurora background, streaming AI transcript top, live user transcript card (clears the AI's question as soon as the user starts answering), mic-mute left / pill blob centre / X-exit right, Recommend button after N turns
  - Mic chunks suppressed while AI plays back, to stop laptop-speaker bleed from being read as barge-in. Trade-off: no true barge-in, only turn-taking.

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] Welcome chips screen (post-calibration UI) is currently parked — needs a stage transition from `conversation` once the fingerprint is "calibrated enough". The Welcome component and chip suggestions are still defined in `WTWApp.tsx`; just wire the transition.
- [ ] Rec card UI (`RecCard`, `POSTERS`, `Rec`) is parked and currently lint-warned as unused — reconnect it once Assignment 2's engine exposes its API. The chips on the Welcome screen are also meant to be wired to the engine then.
- [ ] Voice "Recommend" handoff: today it just calls `handleSubmit("Show me recommendations")` which the LLM responds to in prose — replace with a real engine call once Assignment 2 exposes it.
- [ ] Persist voice transcripts as DNA signals (Assignment 3 handoff)

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
**Last updated:** —
**Completed:**
- [ ] Nothing yet

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] —

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
