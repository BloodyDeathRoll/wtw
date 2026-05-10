# Cinematic — Team Assignments
*Three parallel workstreams for three Claude Code sessions*
*Each assignment produces a self-contained module. All three connect via the Master DNA Schema.*

---

## The shared contract (read this first, all three of you)

Before starting your assignment, save this file as `docs/master_dna_schema.json` in your project root. Every module reads from or writes to this structure. Do not deviate from field names or types without team agreement.

```json
{
  "metadata": {
    "user_id": "string",
    "schema_version": "1.2",
    "taste_version": 14,
    "last_updated": "ISO-8601 date",
    "total_sessions": 0,
    "fingerprint_embedding_ref": "pgvector row ID"
  },

  "strand_a_creative_affinity": {
    "directors": {
      "<tmdb_person_id>": {
        "name": "string",
        "score": "float -1.0 to 1.0",
        "confidence": "float 0.0 to 1.0",
        "sample_size": "integer",
        "lineage_boost": "none | low | medium | high"
      }
    },
    "writers": { "same structure as directors": {} },
    "cinematographers": { "same structure as directors": {} },
    "actors": { "same structure as directors": {} }
  },

  "strand_b_narrative_dimensions": {
    "moral_ambiguity":        { "value": "low|medium|medium_high|high", "confidence": 0.0, "notes": "string" },
    "narrative_complexity":   { "value": "low|medium|medium_high|high", "confidence": 0.0, "notes": "string" },
    "emotional_demand":       { "value": "low|medium|medium_high|high", "confidence": 0.0, "notes": "string" },
    "originality_weight":     { "value": 0.0, "confidence": 0.0, "notes": "string" },
    "humor_style":            { "value": "string", "confidence": 0.0, "notes": "string" },
    "protagonist_type":       { "value": "string", "confidence": 0.0, "notes": "string" },
    "ensemble_vs_solo":       { "value": "string", "confidence": 0.0, "notes": "string" }
  },

  "strand_c_visceral_specs": {
    "pacing_weights":  { "slow-burn": 0.0, "moderate": 0.0, "high-octane": 0.0 },
    "tone_weights":    { "cynical": 0.0, "warm": 0.0, "dark": 0.0, "comedic": 0.0 },
    "aspect_weights":  {
      "cinematography": 0.0, "dialogue": 0.0, "pacing": 0.0,
      "world_building": 0.0, "acting": 0.0, "score_music": 0.0
    }
  },

  "contextual_logic": {
    "exclusion_rules": [
      { "type": "person|genre|keyword|franchise", "id": "string", "name": "string", "reason": "string" }
    ],
    "soft_preferences": [
      { "signal": "string", "weight_modifier": 0.0 }
    ],
    "temporal_modifiers": [
      { "condition": "string", "boost": "string", "suppress": "string" }
    ]
  },

  "signals": [
    {
      "title": "string",
      "type": "movie|tv",
      "reaction": "loved|liked|mixed|disliked",
      "quick_rating": "1-5 integer",
      "regret_signal": "glad_watched|neutral|regret|null",
      "source": "onboarding|session_N|recommendation_accepted|manual",
      "reason": "string — why the user reacted this way",
      "dimensions_reinforced": ["strand_b field names"],
      "confidence": 0.0,
      "flag": "null|reason_needed|rewatch_candidate"
    }
  ],

  "learning_loop": {
    "open_questions": [
      "string — things the system doesn't know yet about this user"
    ],
    "temporal_decay_applied": true,
    "stretch_pick_history": [
      { "title": "string", "accepted": true, "session": 0 }
    ],
    "recommendation_history": [
      { "session": 0, "recommended": "string", "accepted": true, "watched": false, "rating": null }
    ]
  }
}
```

**Rules all three modules must follow:**
- Never overwrite the full schema — always merge/patch specific fields
- Always update `metadata.taste_version` (increment by 1) and `metadata.last_updated` after any write
- Confidence values only increase when new corroborating signals arrive; they decrease when contradicted
- `open_questions` is append-only during a session; the Writing module resolves them
- The schema lives in Supabase as a JSONB column on the `users` table, mirrored to pgvector as an embedding

---

## Assignment 1 — The Onboarding & Conversational Session Brain

**Owner:** [Team member 1]
**What you're building:** The user-facing experience — how a new user gets their initial DNA, and how every subsequent session feels like talking to someone who already knows them.

### The UX model (important — read before coding)

This is **not** a form or a wizard. Per Eran's notes: no surveys, no dropdowns, no ratings grids. The experience is conversational — a back-and-forth that feels like talking to a knowledgeable friend. The system asks smart questions, listens to answers, and only asks about what it doesn't know yet. A user who just says "I loved Succession, find me something like it" should get a great recommendation by session 1 and an even better one by session 5, without ever filling out a single form.

The optional quick-flip 1–5 rating and deep aspect survey (from the main plan) exist as an *alternative* entry point for users who prefer structured input — but the primary experience is conversational.

### Screens and flows to build

**Onboarding conversation (new users)**

A chat interface. The LLM plays the role of a film-savvy concierge. It starts by asking the user to name a few films or shows they've loved recently, then asks follow-up questions to understand *why* — not what genre they pick from a list, but what it was about those specific titles that resonated. The conversation should feel like 5–10 minutes, not 5–10 hours.

The LLM has a hidden system prompt that instructs it to extract DNA schema fields from the conversation as it progresses, and to only ask about dimensions that are still low-confidence or unanswered. When it has enough signal, it stops asking and summarizes what it's learned in plain language: "Based on our conversation, here's what I know about you so far..." The user can correct or add to this summary before it's saved.

At the end of onboarding, call the Schema Writer (Assignment 3) to produce the initial DNA document.

**Session brain (returning users)**

Every time a returning user opens the app, they can either:
- Browse the recommendation feed (Assignment 2 generates this)
- Start a conversation: "I'm bored, find me something light" / "Just finished Succession, what next?" / "I want something like Gone Girl but less dark"

The session brain reads the full DNA schema before the conversation starts. It knows what the user has already told it. It does not ask about things it already knows — it only probes dimensions that are still low-confidence or flagged as `open_questions`.

The conversation ends with a recommendation (1–3 titles, not a list of 20). Each recommendation includes a brief, warm explanation of why it fits *this specific user* — not generic praise for the title.

After the session, the session brain passes a session summary to the Schema Writer (Assignment 3) for DNA updates.

### Technical spec

**Stack:** Next.js 15, Tailwind, shadcn/ui, Vercel AI SDK (streaming), Groq (Llama 3.3 70B) for conversation, Supabase for schema read/write.

**Key components to build:**
- `ConversationInterface` — chat UI with streaming responses, shadcn-styled, mobile-first
- `OnboardingFlow` — wraps ConversationInterface with onboarding-specific system prompt and completion detection
- `SessionBrain` — wraps ConversationInterface for returning user sessions, pre-loads DNA schema, generates session summary on close
- `DNASummaryCard` — shown at end of onboarding and accessible from profile: plain-language summary of what the system knows about the user, editable

**System prompt architecture (critical):**

The LLM needs two things injected into every call:
1. The current DNA schema as structured context (not dumped as raw JSON — summarized into natural language by a pre-processing function)
2. A list of `open_questions` from the schema, so it knows what to probe

The LLM returns two things in its response:
1. The conversational reply (shown to user, streamed)
2. A structured extraction block (hidden from user) containing any new DNA signals identified in this turn

Use Vercel AI SDK's `streamObject` for the extraction block so it's typed and parseable.

**API routes to build:**
- `POST /api/conversation/message` — send a message, get streaming reply + extraction block
- `POST /api/conversation/end-session` — finalize session, pass summary to Schema Writer
- `GET /api/dna/summary` — return plain-language summary of user's DNA for display

**Interfaces you must export (Assignment 2 and 3 depend on these):**

```typescript
// The session summary passed to Assignment 3 after every session
export interface SessionSummary {
  session_number: number;
  new_signals: DNASignal[];           // titles discussed with reactions
  dimension_updates: Partial<StrandB>; // narrative dimensions updated this session
  open_questions_resolved: string[];   // questions from schema that were answered
  new_open_questions: string[];        // new unknowns surfaced this session
  recommendation_made: string | null;  // title recommended (if any)
  recommendation_accepted: boolean | null;
}

// The context object Assignment 2 needs to personalize the feed
export interface SessionContext {
  current_mood_signal: string | null;   // e.g. "tired", "wants something light"
  immediate_request: string | null;     // e.g. "something like Succession"
  session_override_active: boolean;     // true = mood overrides dimension defaults this session
}
```

### What you hand off

At the end of your assignment, the following must work end-to-end:
- A new user can have an onboarding conversation and produce a valid DNA schema document
- A returning user can open a session, get a recommendation, and have the session summary ready for the Schema Writer to process
- All components are exported cleanly from `src/modules/session/`

---

## Assignment 2 — The Recommendation & Discovery Engine

**Owner:** [Team member 2]
**What you're building:** The intelligence layer — how the DNA schema becomes a ranked list of recommendations. This module never talks to the user directly; it takes a DNA schema as input and returns ranked, explained recommendations as output.

### What this module does

Given a user's DNA schema (from Supabase) and an optional session context (from Assignment 1), produce a ranked list of recommendations with:
- A composite score per title
- A `reason_payload` explaining exactly what fired and what didn't
- A stretch pick (1 per 20 results) intentionally outside the fingerprint
- Plain-language explanations ready for the "Why this?" button

### The scoring pipeline

**Step 1 — Candidate generation**

Pull ~200 unwatched titles from the local TMDB cache. Apply hard filters first:
- Remove all titles in `contextual_logic.exclusion_rules`
- Remove all titles already in the user's `signals` array (watched)
- Filter by any session-level constraints (e.g. user said "something short" → filter by runtime)

**Step 2 — Composite scoring**

For each candidate, compute a score from these weighted components:

```
composite_score =
  (crew_affinity_score   × 0.35) +   // strand_a match
  (narrative_match_score × 0.30) +   // strand_b cosine similarity via pgvector
  (visceral_match_score  × 0.20) +   // strand_c pacing/tone/aspect match
  (external_rating_score × 0.10) +   // TMDB + OMDB ratings normalized to 0-1
  (recency_boost         × 0.05)     // slight boost for newer releases
```

**Crew affinity score:** For each of the title's director, writers, cinematographer, and top cast, look up their score in strand_a. Weight by role: director (0.4), writer (0.3), cinematographer (0.15), cast (0.15 split across top 3). Multiply each score by the person's `confidence` value.

**Lineage boost:** For every crew member with `lineage_boost: "medium" | "high"`, also traverse the creative lineage graph (stored as JSONB in the `titles` table) and apply a fractional boost to titles by their influences/disciples. Full lineage boost: 2-degree traversal, weight halved per degree.

**Narrative match score:** Convert strand_b values to a numeric vector. Compare against the title's own narrative embedding (generated at ingest time). Use pgvector cosine similarity.

**Visceral match score:** Direct comparison of strand_c pacing/tone weights against the title's TMDB genre tags and any LLM-extracted tone metadata stored in the titles cache.

**Step 3 — Soft preference modifiers**

After scoring, apply `contextual_logic.soft_preferences` as multipliers. A soft preference of `weight_modifier: 0.7` for "less political" reduces any title tagged political by 30%. These are not eliminations — they're score adjustments.

Apply `contextual_logic.temporal_modifiers` if a session context is provided and the condition matches (e.g. `evening_tired` → suppress slow-burn candidates).

**Step 4 — LLM re-ranking**

Take the top 50 scored candidates. Construct a prompt for Groq that includes:
- The user's strand_b and strand_c in plain language (not raw JSON)
- The top 50 candidates with their titles, crew, and genre tags
- Instruction: re-rank based on nuanced tonal and thematic resonance that the numeric scoring couldn't capture

Return the final top 20, with Groq's ranking rationale per title stored in `reason_payload`.

**Step 5 — Stretch pick injection**

Every 20th slot is replaced with a stretch pick: a title with a low composite score but a high external rating and a deliberate mismatch on at least one major dimension. Label it clearly. Log it in `learning_loop.stretch_pick_history`. The stretch pick is suppressed if `total_sessions < 3` or if fewer than 15 signals exist in the schema.

**Step 6 — Reason payload assembly**

For each title in the final 20, build a `reason_payload`:

```typescript
interface ReasonPayload {
  crew_matches: { name: string; role: string; affinity_score: number }[];
  lineage_connections: { from: string; to: string; relationship: string }[];
  dimension_matches: { dimension: string; user_value: string; title_value: string }[];
  soft_preferences_applied: { signal: string; modifier: number }[];
  external_ratings: { source: string; score: number }[];
  is_stretch_pick: boolean;
  stretch_rationale: string | null;
  groq_rationale: string;  // from re-ranking step
  negative_signals: string[];  // what did NOT fire ("not recommended for genre — inconsistent ratings")
}
```

**Step 7 — Plain-language explanation generation**

For each title, call Groq with the `reason_payload` and generate a 2–3 sentence explanation in warm, conversational language. This is what the "Why this?" button shows. Include one negative signal in every explanation.

Example output: *"Recommended because you consistently rate Denis Villeneuve's work near the top of your list, and this film shares his cinematographer. Your one likely reservation: you tend to rate slow second acts lower, and this one has a long one."*

**Step 8 — Cache**

Store the ranked list in Upstash Redis with a 6-hour TTL, keyed by `user_id + fingerprint_version`. Invalidate on any schema write. For co-watch sessions, cache the intersection result separately keyed by `room_code`.

### Co-watch intersection mode

When called with two DNA schemas instead of one (from a co-watch room session):
- Run the full pipeline for each user independently up to Step 3
- Compute an intersection score: geometric mean of both users' composite scores per title
- Re-rank top 50 by intersection score
- Generate a co-watch explanation for each result: why it works for *both* users specifically

### Technical spec

**Stack:** Next.js 15 API routes, Vercel AI SDK, Groq, Supabase (pgvector queries), Upstash Redis.

**API routes to build:**
- `POST /api/recommendations/generate` — generate recommendations for a user
- `POST /api/recommendations/cowatch` — generate co-watch intersection recommendations
- `GET /api/recommendations/explain` — get plain-language explanation for a specific recommendation
- `POST /api/recommendations/feedback` — log stretch pick accept/reject, pass to Assignment 3

**TMDB + content enrichment utilities to build:**
- `fetchAndCacheTitle(tmdb_id)` — fetch title detail, crew, genres, store in local titles table
- `enrichTitleWithNarrative(tmdb_id)` — LLM-extract narrative dimensions from title synopsis + reviews, store as JSONB and generate embedding
- `buildLineageGraph(person_id)` — fetch influence relationships from Wikipedia/Criterion cache, store as adjacency list on crew record
- `runNightlyEnrichment()` — Supabase cron: enrich any titles in recommendations that lack narrative metadata

**Interfaces you must export (Assignment 1 and 3 depend on these):**

```typescript
export interface RecommendationResult {
  title: string;
  tmdb_id: string;
  type: 'movie' | 'tv';
  composite_score: number;
  reason_payload: ReasonPayload;
  explanation: string;
  is_stretch_pick: boolean;
  generated_at: string;
  fingerprint_version: number;
}

export interface CowatchResult extends RecommendationResult {
  score_user_a: number;
  score_user_b: number;
  cowatch_explanation: string;
}
```

### What you hand off

At the end of your assignment, the following must work end-to-end:
- Given a valid DNA schema, produce a ranked list of 20 recommendations with explanations
- Co-watch mode works for two schemas
- All TMDB enrichment and lineage graph utilities are in `src/modules/engine/`
- Nightly enrichment cron is configured in Supabase

---

## Assignment 3 — The DNA Schema Writer & Profile System

**Owner:** [Team member 3]
**What you're building:** The memory layer — how the app gets smarter over time. Every session produces a `SessionSummary` (from Assignment 1). Every recommendation produces feedback signals (from Assignment 2). Your job is to translate all of that into clean, structured updates to the DNA schema, and to surface the user's profile back to them in a way they can understand and edit.

### Why this is the hardest assignment

Eran's note is exactly right: *"Writing & Updating: Take what happened in the session and translate it back into clean, structured profile updates. This is the part where the app gets smarter over time — and it's harder than it sounds."*

It's hard because:
- The same title can reinforce multiple dimensions simultaneously
- Reactions can be contradictory (loved a slow-burn, hated a different slow-burn — why?)
- Confidence values must go up when corroborated and down when contradicted, not just accumulate
- `open_questions` must be resolved intelligently, not just deleted
- The schema must stay human-readable, not degrade into pure numerics over time
- Temporal decay must be applied correctly without erasing valid long-term signals

### The schema update pipeline

**Trigger:** Called after every session (receives `SessionSummary` from Assignment 1) and after every recommendation feedback event (receives accept/reject/regret signal from Assignment 2).

**Step 1 — Signal integration**

For each new signal in `SessionSummary.new_signals`:

1. Add to `signals` array with full metadata
2. Identify which strand_b dimensions this signal reinforces or contradicts (use the LLM to extract this — send the signal's `reason` field and ask which dimensions it speaks to)
3. Update those dimensions:
   - If corroborating: increase `confidence` by `0.05 × sample_size_weight` (diminishing returns — confidence grows slower as sample size grows)
   - If contradicting: decrease `confidence` by `0.08`, update `notes` to capture the contradiction
4. Update strand_a crew scores: for each crew member on the watched title, adjust their score by `±0.1 × reaction_weight` (loved = +0.1, liked = +0.05, mixed = 0, disliked = -0.1), weighted by current confidence

**Step 2 — Regret signal processing**

When a regret signal arrives (24–72hr post-watch):
- `glad_watched`: small boost (+0.05) to all dimensions the title reinforced. Note in the signal.
- `neutral`: no change
- `regret`: reduce the weight of dimensions the title reinforced by -0.05. If this contradicts the immediate reaction, flag as `open_question`: "User enjoyed [title] in the moment but regretted it — what was missing?"

**Step 3 — Stretch pick feedback**

When a stretch pick is accepted and watched:
- Identify which dimensions the stretch pick violated (what made it a stretch)
- If the user loved it: expand those dimensions — increase tolerance for that dimension's value
- If the user hated it: reinforce the original dimension values, increase their confidence

**Step 4 — Open question resolution**

Review `learning_loop.open_questions` after each session update. For each open question, check if any new signals have provided an answer. Use the LLM to evaluate: "Given these new signals, does this open question have a plausible answer now?"

If yes: resolve the question, update the relevant dimension, remove from open_questions.
If still unresolved: keep. If contradicted further: update the question to reflect new complexity.

**Step 5 — Temporal decay**

Run on schema load (lazy) and nightly (eager). For each signal older than 18 months: multiply its contribution weight by 0.5. This is reflected in dimension confidence, not in the signal itself (signals are never deleted — they're historical record). Update `learning_loop.temporal_decay_applied`.

**Step 6 — Embedding regeneration**

After any update that changes strand_a, strand_b, or strand_c by more than a threshold (>10% shift in any major value): trigger Mistral embedding regeneration. Update `metadata.fingerprint_embedding_ref` with the new pgvector row ID. Increment `metadata.taste_version`.

**Step 7 — Notes maintenance**

The `notes` field on each strand_b dimension is critical — it's what makes the system feel like a concierge rather than an algorithm. After significant updates, use the LLM to rewrite the notes field in plain language, incorporating new evidence. The note should read like something a smart human would say: *"Enjoys moral complexity but needs an emotional anchor to stay invested — pure nihilism loses him."*

### Profile UI to build

The user's DNA profile should be fully visible and editable. This is not a settings page — it's a living document the user feels ownership over.

**Profile surfaces:**

`/profile/dna` — The main DNA view. Shows strand_b dimensions in plain language (not field names — "You prefer morally complex stories" not "moral_ambiguity: high"). Each dimension shows confidence as a subtle indicator (low confidence = displayed lighter/smaller). User can tap any dimension to add context, correct it, or reset it.

`/profile/history` — Signal history. Chronological list of everything the system has learned about the user, with the title, reaction, and which dimensions were updated. User can flag any signal as wrong or add a note.

`/profile/rules` — Exclusion rules and soft preferences from the free-text instruction box. List view, each rule shows the original text and the parsed result. User can delete any rule or add new ones directly.

`/profile/open-questions` — Optional advanced view. Shows what the system still doesn't know about the user. Some users will find this delightful.

**DNA summary card:**

A condensed, shareable card (also shown at end of onboarding) that summarizes the user's taste in 4–5 sentences. Generated by LLM from the schema. Should read like something a knowledgeable friend wrote, not a data printout.

Example: *"You gravitate toward morally complex stories with sharp dialogue and strong ensemble casts. You need emotional investment but not emotional destruction — warmth with edge rather than pure darkness. Villeneuve, Sorkin, and Sorkin-adjacent writers consistently hit for you. You're allergic to formula and reliably find the non-obvious pick more satisfying than the crowd-pleaser."*

### Technical spec

**Stack:** Next.js 15, Tailwind, shadcn/ui, Supabase (JSONB updates + pgvector), Vercel AI SDK, Groq, Mistral (embeddings).

**API routes to build:**
- `POST /api/dna/update-from-session` — receives SessionSummary, runs full update pipeline
- `POST /api/dna/update-regret` — receives regret signal for a specific watch entry
- `POST /api/dna/update-stretch-feedback` — receives stretch pick outcome
- `POST /api/dna/parse-instruction` — receives free-text instruction, calls Groq parser, writes exclusion/soft rules
- `GET /api/dna/summary` — returns plain-language summary (cached, invalidated on version bump)
- `PATCH /api/dna/dimension` — user manually corrects a dimension
- `DELETE /api/dna/signal` — user flags a signal as wrong

**Key utilities to build:**
- `mergeSchemaUpdate(existing: DNASchema, update: Partial<DNASchema>): DNASchema` — the core merge function, handles all conflict resolution
- `applyTemporalDecay(schema: DNASchema): DNASchema` — applies decay to contribution weights
- `generateDNASummary(schema: DNASchema): Promise<string>` — LLM call, returns plain-language summary
- `rewriteDimensionNote(dimension: string, evidence: DNASignal[]): Promise<string>` — LLM rewrites a single dimension's notes field
- `resolveOpenQuestion(question: string, new_signals: DNASignal[]): Promise<{resolved: boolean, answer?: string}>` — LLM evaluates whether new signals answer an open question
- `regenerateEmbedding(schema: DNASchema): Promise<string>` — calls Mistral, updates pgvector, returns new row ID

**Interfaces you must export (Assignment 1 and 2 depend on these):**

```typescript
export interface DNASchema { /* the full master schema structure above */ }
export interface DNASignal { /* the signals array item type */ }
export interface StrandA { /* creative_affinity strand */ }
export interface StrandB { /* narrative_dimensions strand */ }
export interface StrandC { /* visceral_specs strand */ }

// Called by Assignment 1 after every session
export async function updateSchemaFromSession(
  user_id: string,
  summary: SessionSummary
): Promise<DNASchema>

// Called by Assignment 2 after regret signal arrives
export async function updateSchemaFromRegret(
  user_id: string,
  watch_entry_id: string,
  signal: 'glad_watched' | 'neutral' | 'regret'
): Promise<void>

// Called by Assignment 2 after stretch pick feedback
export async function updateSchemaFromStretch(
  user_id: string,
  title: string,
  reaction: 'loved' | 'liked' | 'mixed' | 'disliked'
): Promise<void>
```

### What you hand off

At the end of your assignment, the following must work end-to-end:
- A SessionSummary from Assignment 1 produces a correct, merged DNA schema update in Supabase
- Regret signals and stretch pick feedback update the schema correctly
- The full profile UI (/profile/dna, /profile/history, /profile/rules) is functional
- All schema utilities are exported from `src/modules/dna/`
- TypeScript interfaces for DNASchema and all sub-types are in `src/types/dna.ts` — shared across all three modules

---

## Integration checklist (run this when all three are ready)

When combining the three modules, verify these connections:

- [ ] Assignment 1 `SessionSummary` type matches what Assignment 3 `updateSchemaFromSession` expects
- [ ] Assignment 2 `RecommendationResult` is displayed correctly in Assignment 1's session brain recommendations
- [ ] Assignment 3's `GET /api/dna/summary` response is consumed correctly by Assignment 1's session brain pre-prompt
- [ ] Assignment 2's `POST /api/recommendations/feedback` calls Assignment 3's `updateSchemaFromRegret` and `updateSchemaFromStretch`
- [ ] `src/types/dna.ts` is the single source of truth — no duplicated type definitions across modules
- [ ] All three modules read the DNA schema from the same Supabase table (`users.fingerprint_json`) using the same Supabase client config
- [ ] Fingerprint version is checked before any recommendation is served — stale cache is invalidated correctly
- [ ] Co-watch room (Assignment 2) loads both users' schemas independently before intersection

---

*Good luck. The shared contract above is the only thing that must not drift — everything else can evolve.*
