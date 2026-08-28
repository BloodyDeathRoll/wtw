# Watchlist — implementation plan

**Written:** 2026-07-30 · **Driver:** A1 (Shahar)
**Status:** steps 1–4 built, type-checked, unit-tested (69/69) and compiling —
**not yet committed, and the flows are not runtime-verified.**

A local-only watchlist. Cards saved from the recommendations feed render in a
dedicated view with the identical layout, and leave the list the moment the user
rates them — at which point the rating goes to the fingerprint through the
existing feedback path.

---

## Settled decisions

| # | Decision |
|---|---|
| 1 | Voice mode keeps its "Recommendations Ready" pill (`VoiceMode.tsx:416`); only the home screen gets the two circular buttons. |
| 2 | **Reversed 2026-08-28.** Watchlisted titles are **excluded** from the recommendations feed: server-side at generation (step1 reads the saved marker in `recommendation_history`) and at read (GET `judged` set), and client-side in `loadMore` for saves not yet reported. A saved title resurfacing as a "new" pick read as a repeat. Unsaving is reported on `/api/session/end` as `watchlist_removed` (`getUnsyncedRemovals()`), which clears the marker so the title can come back. *(Was: stay in the feed with the CTA in its "Remove from watchlist" state.)* |
| 3 | The watchlist ignores the Movies/Series toggle — it's a personal list; hiding half of it behind a global filter reads as data loss. |
| 4 | The Recommendations circle keeps the existing `showRecommend` gate (mature greeting or ≥2 assistant turns). The Watchlist circle appears as soon as one title is saved. |
| 5 | The "Why this pick?" payload is snapshotted into the watchlist entry at add time. |
| 6 | Watchlist adds piggyback on the `/api/session/end` body — no extra round-trip, no extra DB call of their own. |
| 7 | Rating a saved title files it in the matching ratings bucket but **leaves it on the watchlist**, tagged with the outcome. Only the card's own "Remove from watchlist" button takes it off. (Revised 2026-07-30 — it used to drop the card.) |
| 8 | No cross-tab `storage` sync. |
| 9 | Full unit coverage for both pure modules. |

**Accepted trade-off:** localStorage is one device, one browser. The watchlist
does not sync across devices, and iOS PWAs can evict it under storage pressure.
That is the price of "no extra DB calls" and is accepted deliberately.

---

## 1. `src/lib/watchlist.ts` — local store

Modelled on `regret-queue.ts`, but **localStorage** (must outlive the tab, unlike
`explain-cache.ts`'s sessionStorage). Key `wtw_watchlist`.

```ts
interface WatchlistEntry {
  rec: Recommendation          // the whole card — renders offline, zero refetch
  added_at: number
  rating: WatchlistRating | null  // loved | liked | disliked | removed — see §5
  explain: ExplainData | null  // snapshot, see §3
  synced: boolean              // false until the intent reaches the fingerprint (§6)
}
```

API: `getWatchlist`, `isInWatchlist`, `addToWatchlist`, `removeFromWatchlist`,
`setWatchlistRating`, `watchlistCount`, `getUnsyncedIds`, `markSynced`.
Reads normalise `rating`, so entries written before the field existed load as
untagged rather than undefined.

Rules:
- Dedup and address on `rec.id` (`type:tmdb_id`) — **never bare `tmdb_id`**; TMDB
  movie and TV ids collide (see migration `0014`, PR #31).
- Newest-first; cap 200, dropping the oldest.
- Every read guarded on `typeof window` and on JSON parse; every write in
  try/catch so a quota error can't break a click.

## 2. Card CTA — `RecommendationsView.tsx` + CSS module

A row wrapper placing `whyPill` left and the new watchlist button right, in all
three renderers: `CompactCard`, `FullCard`, `WhyDetailOverlay`. New
`.watchlistBtn` — filled/accent against `whyPill`'s ghost styling so it reads as
the dominant action. Label and `aria-pressed` toggle off `isInWatchlist(rec.id)`.

Membership lives in `RecommendationsView` as a `Set<string>` seeded on mount, so
a toggle re-renders the card without re-reading storage.

> **Layout gets measured in the running app at the real viewport** — not derived
> from the box model. That's the standing constraint from the `.sentinel` spacing
> fix, and a two-up row inside a card is exactly where it bites.

## 3. Explain snapshot

`addToWatchlist` also stores `getCachedExplain(rec.id)`, prefetching it on a cache
miss (one request, at the moment of an explicit user action). `WhyDetailOverlay`
gains a lookup order: session cache → **watchlist snapshot** → network.

Without this, "Why this pick?" 404s on anything saved more than a rec-cache TTL
ago, because `/api/recommendations/explain` reads the Redis rec cache.

## 4. `mode="watchlist"`

Add to the `Mode` union; `HEADER_TITLE.watchlist = "Watchlist"`. In this mode
`loadMore` reads `getWatchlist()` and pages client-side instead of fetching; no
`onFindMore`; no content-type filter. Empty state plus a "Browse
recommendations" action. Compact/full/swipe/Why all come free — the point of
reusing the component.

## 5. Judging a saved title — it stays, tagged

A rating is not a reason to lose the card. `handleFeedback` and `handleRemove`
call `setWatchlistRating(rec.id, …)` instead of removing, and in watchlist mode
the card keeps its place showing the outcome tag ("Loved — weighted strongly into
your taste", "Removed — won't be recommended again", …). `RatingsView.reRate`
re-tags the same way, so the two screens never disagree.

`removeFromWatchlist` now has exactly one caller: the card's own CTA. That call
also clears the stored tag, so re-saving a title later offers the reactions again
instead of resurrecting the old outcome.

In the **feed**, "Remove" still makes the card disappear — that's the entire
point of the control there. Only the watchlist keeps it.

Tags are read back from the store when the view mounts, so they survive
navigating away and returning.

The existing POST already files it correctly: `loved`/`liked` →
`action: 'watched'`, `disliked` → `action: 'skipped'`, both carrying `reaction`,
with `is_stretch_pick` riding along from the stored card so the stretch-pick
signal survives. Remove still goes to `/api/recommendations/removed`.

## 6. Home screen + menu — `WTWApp.tsx`

Replace `RecommendPill` in `recommendBar` with two circular icon buttons;
Watchlist carries a count badge and renders only when `watchlistCount() > 0`. New
`Stage: "watchlist"` and a render branch mounting
`RecommendationsView mode="watchlist"`. `TopBar` gains `onRecommend`/
`onWatchlist` and two menu rows above "Fast learning". The count refreshes on
mount and on every return to `onboard`. `RecommendPill` stays in the repo for
voice (decision 1).

Piggyback: `endSessionAndGenerate` adds `watchlist_added: getUnsyncedIds()` to the
existing `/api/session/end` body and calls `markSynced` on a 200.

## 7. Fingerprint action item — the intent signal

**Do not put a watchlist add into `dna.signals`.** Two independent failure modes:

- `mergeFeedbackSignalsLight` (`src/modules/dna/merge-feedback-signal.ts`) and
  `foldRatedHistoryIntoSummary` (`src/modules/session/feedback-signals.ts`) both
  dedup on **bare `tmdb_id` across all sources**. A watchlist signal landing
  first would silently swallow the user's later loved/liked/disliked for that
  title — the weakest signal in the product eating the strongest.
- `step1-candidate-gen.ts:27` builds `watched_keys` from `dna.signals`, so the
  title would vanish from every future generated batch, contradicting decision 2.

**Chosen encoding — no contract change.** `/api/session/end` marks the
piggybacked ids in `learning_loop.recommendation_history` as
`accepted: true, watched: false, rating: null`. Nothing produces that combination
today (the feedback route moves `accepted` and `watched` together), so it is an
unambiguous "saved, not yet watched" marker. It sits outside `dna.signals` — no
dedup poisoning, no candidate exclusion — and the feedback route's `watched`
branch supersedes it automatically when the user later rates. Available to
scoring whenever A2 wants to weight interest.

The alternative — a first-class `saved: boolean` on `RecommendationRecord`, or
`'watchlist_added'` on `SignalSource` — reads better but touches
`src/types/dna.ts`, which needs all three sign-offs. Raise as a follow-up, not a
blocker.

New helper `src/modules/session/watchlist-intent.ts` holds the pure
`markSavedInHistory(history, ids)` so it is unit-testable, called from
`session/end` before `updateSchemaFromSession`. Ids arrive as `type:tmdb_id` and
are split on the **last** colon.

## 8. Tests — `tests/unit/`

`watchlist.test.ts` — add/remove round-trip · dedup by composite id · movie/TV id
collision keeps both entries · cap evicts oldest · corrupt JSON reads as empty ·
quota-exceeded write doesn't throw · newest-first ordering · SSR (`window`
undefined) returns empty · `getUnsyncedIds`/`markSynced` transitions · explain
snapshot stored and retrieved.

`watchlist-intent.test.ts` — marks a matching history entry
`accepted: true, watched: false` · leaves `rating` untouched · doesn't clobber an
entry already `watched: true` · unknown id is a no-op · composite-key split
handles a TV id colliding with a movie id · empty id list is a no-op.

## 9. PR split

Three short-lived branches off `main`, each independently reviewable:

1. **`feat/watchlist-store`** — §1 + the first test suite. Pure, no UI.
   `src/lib/` is shared per `GITGUIDE.md` — call it in the group chat.
2. **`feat/watchlist-view`** — §2–§5. The user-visible feature; needs the
   real-viewport layout check.
3. **`feat/watchlist-home-and-intent`** — §6 + §7 + the second suite. Touches
   `src/app/` and the DNA seam, so it wants A3's review.
4. **`feat/watchlist-regret-hook`** — §10. One call site.

## 10. Regret loop

Rating a title off the watchlist is the one place in the recommendations view
where "the user watched this" is unambiguous — a rating in the feed can be a
reaction to something they saw years ago. So `handleFeedback` queues the 48-hour
glad/neutral/regret check-in via `addToRegretQueue`, in watchlist mode only, and
only for `loved`/`liked` (a `disliked` title has already told us how it landed).

This is the same queue `RecCard` writes on "watched".

**The prompt is now surfaced** (Integration Checklist §2, previously open):
`WTWApp` reads `getPendingRegretChecks()` once per page load and renders one
`RegretPrompt` at a time on the **onboard view** — where every session lands, and
where a time-sensitive prompt won't get buried in a scrolling feed. `RegretPrompt`
marks the queue entry itself; the parent only drops it from state after the
confirmation plays. `onDone` was widened to hand back the whole `RegretEntry`, so
the parent keys on `(tmdb_id, type)` and can't drop the wrong title on a
collision.

**Fixed as part of this step:** `regret-queue.ts` used to dedup on bare
`tmdb_id`, so a movie and a TV title sharing an id collapsed to one queue entry —
one would suppress the other's check-in, and answering either marked both
reacted. It now keys on `(tmdb_id, type)` via a `sameTitle` helper, and
`markRegretReacted` takes the type as a required argument so the compiler forces
every call site to be correct. `RegretEntry` already carried `type`, so stored
queues need no migration. Covered by `tests/unit/regret-queue.test.ts`.

## 11. Once judged, never recommended again

`GET /api/recommendations/generate` filtered only `removed_titles`, so a title the
user had rated could still be **served** from a Redis cache built before that
rating — the write path excluded it (step1 candidate-gen skips everything in
`dna.signals`) but the read path did not, and a plain GET has no reason to
regenerate.

`servePage` now drops anything in `dna.signals` as well, keyed
`${type}:${tmdb_id}` to match candidate-gen exactly and to avoid the movie/TV id
collision. Removal stays tracked separately in `removed_titles`, so restoring a
title there genuinely brings it back — unless it was also rated, which is a
stronger judgement of its own.

## Still open

- **`saved: boolean` on `RecommendationRecord`** (the cleaner alternative to the
  §7 encoding) is **blocked**: it modifies `src/types/dna.ts`, which needs all
  three collaborators' approval. Raise in the group chat.
- **Runtime verification** of every watchlist flow against live Supabase + Redis.
  None of it has been exercised in a browser yet: save from a card → appears in
  the watchlist → rate it → leaves the list and lands in the right ratings bucket
  → "Why this pick?" still resolves from the snapshot after the rec cache expires
  → `watchlist_recorded` comes back non-zero from `/api/session/end`.
