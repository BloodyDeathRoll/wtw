/**
 * watchlist.ts
 *
 * localStorage-backed watchlist. Saving a card stores the ENTIRE
 * Recommendation object, so the watchlist view renders the identical layout
 * with no refetch and no extra DB call — the whole point of the feature.
 *
 * localStorage, not sessionStorage (unlike explain-cache.ts): a watchlist has
 * to outlive the tab. The trade-off is deliberate and documented in
 * docs/watchlist-plan.md — the list is per-device and does not sync.
 *
 * Flow:
 *   1. User taps "Add to watchlist" on a card → addToWatchlist()
 *   2. Watchlist view renders getWatchlist()
 *   3. User rates or removes the title → removeFromWatchlist() + the existing
 *      feedback/removed API call, which is what reaches the fingerprint
 *   4. Session end piggybacks getUnsyncedIds() → markSynced() on success
 */

import type { FeedbackRating, Recommendation } from "@/types/recommendation"
import type { ExplainData } from "@/lib/explain-cache"

const STORAGE_KEY = "wtw_watchlist"

// Storage backstop, not a product limit. localStorage caps at ~5MB and an entry
// is ~1KB, so this is nowhere near the ceiling — it just stops an unbounded list
// from ever getting there.
const MAX_ENTRIES = 200

/**
 * How a saved title was judged. Ranking a title does NOT take it off the
 * watchlist — it stays, tagged, and only the card's own "Remove from watchlist"
 * button takes it off. "removed" is the suppression action, not a rating.
 */
export type WatchlistRating = FeedbackRating | "removed"

export interface WatchlistEntry {
  /** The full card as it was served — renders without touching the network. */
  rec: Recommendation
  added_at: number // Unix timestamp (ms)
  /** Set once the user rates or removes the title; null while untouched. */
  rating: WatchlistRating | null
  /**
   * "Why this pick?" breakdown captured at add time. /api/recommendations/explain
   * reads the Redis rec cache, which expires — without this snapshot the Why
   * button 404s on anything saved a while ago.
   */
  explain: ExplainData | null
  /** False until the add has been reported to the fingerprint (session end). */
  synced: boolean
}

function readList(): WatchlistEntry[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    // Drop anything without an addressable id — a malformed entry would
    // otherwise be un-removable from the UI. `rating` is normalised because
    // entries saved before it existed have no such field.
    return (parsed as WatchlistEntry[])
      .filter((e) => typeof e?.rec?.id === "string")
      .map((e) => ({ ...e, rating: e.rating ?? null }))
  } catch {
    return []
  }
}

function writeList(list: WatchlistEntry[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Quota exceeded / storage disabled. Saving is best-effort: a failed write
    // must never break the click that triggered it.
  }
}

/** Saved titles, newest first. */
export function getWatchlist(): WatchlistEntry[] {
  return readList()
}

/**
 * Is this title saved? `id` is the Recommendation id — "type:tmdb_id" for engine
 * recs, a bare slug for pre-session mocks. Always the composite id, never a bare
 * tmdb_id: TMDB movie and TV ids collide (migration 0014).
 */
export function isInWatchlist(id: string): boolean {
  return readList().some((e) => e.rec.id === id)
}

export function watchlistCount(): number {
  return readList().length
}

/**
 * Save a card. Idempotent — re-adding an already-saved title keeps its original
 * position and synced state, but backfills the explain snapshot if we didn't
 * have one and now do.
 */
export function addToWatchlist(rec: Recommendation, explain: ExplainData | null = null) {
  const list = readList()
  const existing = list.findIndex((e) => e.rec.id === rec.id)

  if (existing >= 0) {
    if (explain && !list[existing].explain) {
      list[existing] = { ...list[existing], explain }
      writeList(list)
    }
    return
  }

  // Newest first, then trim the oldest past the cap.
  const next = [
    { rec, added_at: Date.now(), rating: null, explain, synced: false },
    ...list,
  ]
  writeList(next.slice(0, MAX_ENTRIES))
  // Re-saved after an unsave: the pending removal is moot (the save will be
  // re-reported), so drop it rather than leave it queued forever.
  const removals = readRemovals()
  if (removals.includes(rec.id)) writeRemovals(removals.filter((id) => id !== rec.id))
}

/**
 * Drop a title. The ONLY way off the watchlist — rating a title keeps it here
 * (tagged), so this is reached solely from the card's own remove control.
 */
export function removeFromWatchlist(id: string) {
  const list = readList()
  const gone = list.find((e) => e.rec.id === id)
  if (!gone) return
  writeList(list.filter((e) => e.rec.id !== id))
  // The fingerprint excludes saved titles from the feed, so an unsave has to
  // reach it too — otherwise the title stays hidden forever. Always queued,
  // even for an entry that never synced: an EARLIER save of the same title
  // may have, and the server-side unmark is a no-op when there's nothing to
  // clear.
  writeRemovals([...new Set([...readRemovals(), id])])
}

// ── Unsave sync ───────────────────────────────────────────────
// Ids whose "removed from watchlist" hasn't reached the fingerprint yet. Kept
// under its own key: the entry itself is gone from the list.
const REMOVALS_KEY = "wtw_watchlist_removed"

function readRemovals(): string[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMOVALS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []
  } catch {
    return []
  }
}

function writeRemovals(ids: string[]) {
  if (typeof window === "undefined") return
  try {
    if (ids.length === 0) window.localStorage.removeItem(REMOVALS_KEY)
    else window.localStorage.setItem(REMOVALS_KEY, JSON.stringify(ids))
  } catch {
    // best-effort, same as writeList
  }
}

/** Ids unsaved since the last successful session/end report. */
export function getUnsyncedRemovals(): string[] {
  // A title re-saved after being unsaved is on the list again; reporting the
  // removal would clear a save that's about to be re-reported anyway, so skip it.
  const saved = new Set(readList().map((e) => e.rec.id))
  return readRemovals().filter((id) => !saved.has(id))
}

/** Mark unsaves as reported. Call only after a successful write. */
export function markRemovalsSynced(ids: string[]) {
  if (ids.length === 0) return
  const done = new Set(ids)
  writeRemovals(readRemovals().filter((id) => !done.has(id)))
}

/**
 * Tag a saved title with how it was judged. A no-op when the title isn't saved,
 * so every rating site can call it unconditionally.
 */
export function setWatchlistRating(id: string, rating: WatchlistRating) {
  const list = readList()
  const at = list.findIndex((e) => e.rec.id === id)
  if (at < 0 || list[at].rating === rating) return
  const next = [...list]
  next[at] = { ...next[at], rating }
  writeList(next)
}

/**
 * Ids whose "saved" intent hasn't reached the fingerprint yet. Sent on the
 * existing /api/session/end body so the intent costs no request of its own.
 */
export function getUnsyncedIds(): string[] {
  return readList()
    .filter((e) => !e.synced)
    .map((e) => e.rec.id)
}

/** Mark ids as reported to the fingerprint. Call only after a successful write. */
export function markSynced(ids: string[]) {
  if (ids.length === 0) return
  const done = new Set(ids)
  const list = readList()
  let changed = false
  const next = list.map((e) => {
    if (!e.synced && done.has(e.rec.id)) {
      changed = true
      return { ...e, synced: true }
    }
    return e
  })
  if (changed) writeList(next)
}
