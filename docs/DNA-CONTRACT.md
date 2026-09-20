# WTW — the DNA contract

Read this before touching `src/types/dna.ts`, `src/modules/dna/`, or any seam between modules.

**`src/types/dna.ts` is authoritative for field names and types.** This file explains the rules
around it; the full field reference is `docs/master_dna_schema.json`.
Changing `dna.ts` requires all three assignment owners to approve.

## Write rules

- **Never overwrite the full schema** — always merge/patch specific fields.
- **Always increment `metadata.taste_version` and update `metadata.last_updated`** after any write.
- Confidence values increase when corroborated, decrease when contradicted.
- **`learning_loop.open_questions` is append-only during a session** — the DNA Writer resolves them.
- The schema lives in Supabase as a JSONB column on the `users` table.

## Top-level structure

```typescript
{
  metadata:               // user_id, schema_version, taste_version, last_updated, total_sessions
  strand_a_creative_affinity:   // directors, writers, cinematographers, actors (score + confidence)
  strand_b_narrative_dimensions: // moral_ambiguity, narrative_complexity, emotional_demand, etc.
  strand_c_visceral_specs:       // pacing_weights, tone_weights, aspect_weights,
                                 // genre_affinity, language_affinity, format_affinity
  contextual_logic:              // exclusion_rules, soft_preferences, temporal_modifiers
  signals:                       // everything watched + reactions (the raw history)
  learning_loop:                 // open_questions, stretch_pick_history, recommendation_history
}
```

## Content affinity — weights vs. affinity entries (added 2026-09-20)

`strand_c` gained three maps: `genre_affinity` (lowercased TMDB genre name), `language_affinity` (ISO 639-1) and `format_affinity` (`movie` | `tv`). Each value is a `ContentAffinityEntry` — `score`, `confidence`, `sample_size` — the same running reaction average `strand_a` keeps per person.

- **They are NOT weights, and must not be recentred.** `pacing_weights` and `tone_weights` are a closed set where only the relative order means anything, so `recenterWeights` pulls the group back to a mean of 0.5 after every update. Genres are a sparse open set: recentring a user who has only rated horror would put their one genre straight back to neutral, which is the exact failure this dimension was added to fix ("27 disliked anime generalised to nothing").
- **Sparse on purpose.** A key exists only once the user has reacted to something carrying it. Absent means *no evidence*, which is not the same as neutral — readers must not fill in 0.5.
- **Optional on the type.** Every fingerprint written before 2026-09-20 has none. `applyContentAffinityUpdate` creates the map on first use; readers treat missing or empty as no evidence. `scripts/backfill-content-affinity.mts` replays existing signals to fill them (idempotent — it resets only these three maps).
- **Writer:** A3, `src/modules/dna/lib/update-content-affinity.ts`, called from every place that folds a rating (`update-from-session`, `merge-feedback-signal`). **Reader:** A2, `src/modules/engine/scoring/content-affinity.ts`, weight 0.15 in the composite.
- It is a **nudge, not a filter**. "No horror" is an `exclusion_rule` and cuts absolutely; this catches the taste the user never put into words. An avoided genre is reported through `negative_signals`, never through `dimension_matches` — everything downstream reads a dimension match as a reason to recommend.

## Title identity — `type:tmdb_id`, never a bare id (decided 2026-08-28)

TMDB movie and TV ids are separate namespaces that collide (617 pairs in the catalog; id 105 is both *Back to the Future* and *Sex and the City*). Every lookup keyed on a bare `tmdb_id` therefore risks resolving the wrong title — which is exactly how rated movies kept being re-recommended: the rating was signaled against the same-id TV show, and the `${type}:${tmdb_id}` exclusions never matched.

- Helpers live in `src/lib/title-key.ts` (`titleKey`, `parseTitleKey`, `recordKey`, `recordMatches`, `matchesKeySet`, `isSavedMarker`). Use them; do not hand-roll keys.
- `RecommendationRecord.recommended` carries the composite `"type:tmdb_id"`. `tmdb_id` stays bare. **No field was added** — `recommended` was always a copy of `tmdb_id`. Legacy rows (before 2026-08-28) have a bare `recommended`; readers treat them as *type unknown* and never guess (`pickTitle` resolves only when the id is unambiguous in the catalog).
- `DNASignal` already carries `type`. **Signal dedup is one signal per `type:tmdb_id` across ALL sources, first wins** (changed 2026-08-28 — the old `+ source` key let chat re-extraction re-signal the same title every session). Card ratings also update strand B from the title's `narrative_metadata` (`update-strand-b-from-title.ts`). `fetchTitleCrew` returns a map keyed by composite key with **both** rows of a colliding id.
- The feedback / survey routes require `media_type` from the client; the regret/stretch/survey hooks take it as a parameter.
- `scripts/repair-title-keys.mts` is the one-off that migrated existing rows (run 2026-08-28 — 5 users, 5 wrong-type signals corrected, every legacy `recommended` rewritten).

## Interfaces between modules

The exact types that connect the three modules. Full definitions live in `src/types/dna.ts`.

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

## Seam status

All three seams were audited 2026-07-30 (code read on both sides, no stubs needed — every seam was
already implemented). Three open calls came out of that audit; they are tracked in
`docs/INTEGRATION.md` §1.
