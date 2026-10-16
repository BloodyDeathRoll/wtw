/**
 * watchlist.ts
 *
 * The watchlist. Saving a card stores the ENTIRE Recommendation object, so the
 * watchlist view renders the identical layout with no refetch.
 *
 * Supabase (`watchlist_entries`, via /api/watchlist) holds the list so it
 * follows the login across devices. localStorage is the synchronous cache every
 * read here comes from: each change lands locally first, is queued, and is
 * pushed in the background; a failed push stays queued for the next one.
 * hydrateWatchlist() replaces the cache with the server's list on app load —
 * and, the first time a device runs it, uploads whatever that device already
 * held (the list used to be localStorage-only).
 *
 * Flow:
 *   1. App load → hydrateWatchlist(userId)
 *   2. User taps "Add to watchlist" on a card → addToWatchlist()
 *   3. Watchlist view renders getWatchlist()
 *   4. User rates or removes the title → removeFromWatchlist() + the existing
 *      feedback/removed API call, which is what reaches the fingerprint
 *   5. Session end piggybacks getUnsyncedIds() → markSynced() on success
 */

import type { FeedbackRating, Recommendation } from "@/types/recommendation"
import type { ExplainData } from "@/lib/explain-cache"

const STORAGE_KEY = "wtw_watchlist"

// Storage backstop, not a product limit. localStorage caps at ~5MB and an entry
// is ~1KB, so this is nowhere near the ceiling — it just stops an unbounded list
// from ever getting there. /api/watchlist applies the same cap.
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
      queueChange(rec.id, "upsert")
    }
    return
  }

  // Newest first, then trim the oldest past the cap.
  const next = [
    { rec, added_at: Date.now(), rating: null, explain, synced: false },
    ...list,
  ]
  writeList(next.slice(0, MAX_ENTRIES))
  queueChange(rec.id, "upsert")
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
  queueChange(id, "delete")
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
  queueChange(id, "upsert")
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

// ── Server sync ───────────────────────────────────────────────
// Changes not yet confirmed by /api/watchlist, coalesced per id: only the last
// change to a title matters. Each carries a token so a change made while its
// push is in flight isn't cleared by that push's success.
const PENDING_KEY = "wtw_watchlist_pending"
// The user whose list the cache holds. Unset on a device that predates server
// sync — its local list is then uploaded once, to whoever logs in first.
const OWNER_KEY = "wtw_watchlist_owner"
/** Fired on window after hydrateWatchlist() rewrites the cache. */
export const WATCHLIST_HYDRATED_EVENT = "wtw:watchlist-hydrated"

type PendingOp = "upsert" | "delete"
type Pending = Record<string, { op: PendingOp; token: string }>

interface WireEntry {
  rec: Recommendation
  explain: ExplainData | null
  rating: WatchlistRating | null
  added_at: number
}

function readPending(): Pending {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "{}")
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const out: Pending = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const p = v as { op?: unknown; token?: unknown }
      if ((p?.op === "upsert" || p?.op === "delete") && typeof p.token === "string") {
        out[id] = { op: p.op, token: p.token }
      }
    }
    return out
  } catch {
    return {}
  }
}

function writePending(pending: Pending) {
  if (typeof window === "undefined") return
  try {
    if (Object.keys(pending).length === 0) window.localStorage.removeItem(PENDING_KEY)
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // best-effort, same as writeList
  }
}

function newToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function markPending(ids: string[], op: PendingOp) {
  if (ids.length === 0) return
  const pending = readPending()
  for (const id of ids) pending[id] = { op, token: newToken() }
  writePending(pending)
}

function queueChange(id: string, op: PendingOp) {
  markPending([id], op)
  void pushPending()
}

let inFlight: Promise<WireEntry[] | null> | null = null
let pushAgain = false

/**
 * Send every queued change. Resolves to the server's list after the push, or
 * null when it failed (the changes stay queued). Calls made while a push is in
 * flight share it, and one more push follows to carry what they queued.
 */
function pushPending(): Promise<WireEntry[] | null> {
  if (inFlight) {
    pushAgain = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      let result: WireEntry[] | null
      do {
        pushAgain = false
        splitRetry = false
        result = await pushOnce()
      } while ((pushAgain && result !== null) || takeSplitRetry())
      return result
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// /api/watchlist takes at most this many changes per request; a longer queue
// (e.g. many unsaves made offline) goes in successive pushes. Pushes are also
// cut by size, well under Vercel's 4.5MB request body limit.
const MAX_CHANGES_PER_PUSH = 200
const MAX_PUSH_BYTES = 1_000_000
// Shrinks while the server refuses whole batches, so one bad change is
// isolated (and dropped alone) instead of taking its batch-mates with it.
let pushLimit = MAX_CHANGES_PER_PUSH
let splitRetry = false

function takeSplitRetry(): boolean {
  const r = splitRetry
  splitRetry = false
  return r
}

async function pushOnce(): Promise<WireEntry[] | null> {
  if (typeof window === "undefined") return null
  const sent = readPending()
  const queued = Object.keys(sent)
  if (queued.length === 0) {
    const res = await fetchEntries("GET")
    return res === "rejected" || res === null ? null : res.entries
  }

  const byId = new Map(readList().map((e) => [e.rec.id, e]))
  const ids: string[] = []
  const upsert: WireEntry[] = []
  const del: string[] = []
  let bytes = 0
  for (const id of queued) {
    if (ids.length >= pushLimit) break
    if (sent[id].op === "delete") {
      ids.push(id)
      del.push(id)
      bytes += id.length + 3
      continue
    }
    const e = byId.get(id)
    // Queued as a save but gone locally (removed since): nothing to send.
    if (!e) {
      ids.push(id)
      continue
    }
    const wire = { rec: e.rec, explain: e.explain, rating: e.rating, added_at: e.added_at }
    const size = JSON.stringify(wire).length
    if (upsert.length > 0 && bytes + size > MAX_PUSH_BYTES) break
    ids.push(id)
    upsert.push(wire)
    bytes += size
  }

  const res = await fetchEntries("POST", { upsert, delete: del })
  if (res === null) return null
  // Refused outright: retry in halves until the culprit travels alone.
  if (res === "rejected" && ids.length > 1) {
    pushLimit = Math.max(1, Math.floor(ids.length / 2))
    splitRetry = true
    return null
  }
  // Clear only what this push carried; a newer change to the same id stays.
  // That includes a lone change the server refused and any it skipped as
  // malformed: they'd be refused on every retry and block the queue behind
  // them, so they stay local only — and vanish at the next hydrate, which
  // replaces the cache with the server's list.
  const now = readPending()
  for (const id of ids) {
    if (now[id]?.token === sent[id].token) delete now[id]
  }
  writePending(now)
  if (res !== "rejected" && res.rejected.length > 0) {
    console.error(`[watchlist] server skipped ${res.rejected.length} malformed change(s)`)
  }
  // Back to full-size pushes once the bad change is gone (or nothing is left);
  // until then stay small so it isn't re-bundled with good changes.
  if (res === "rejected" || res.rejected.length > 0 || Object.keys(now).length === 0) {
    pushLimit = MAX_CHANGES_PER_PUSH
  }
  if (Object.keys(now).length > 0) pushAgain = true
  if (res !== "rejected") return res.entries
  const list = await fetchEntries("GET")
  return list === "rejected" || list === null ? null : list.entries
}

async function fetchEntries(
  method: "GET" | "POST",
  body?: { upsert: WireEntry[]; delete: string[] },
): Promise<{ entries: WireEntry[]; rejected: string[] } | null | "rejected"> {
  try {
    const res = await fetch("/api/watchlist", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    // Refused as a whole (bad request / too large): resending it unchanged
    // can't succeed — pushOnce splits it, or drops a lone change.
    if (res.status === 400 || res.status === 413) {
      console.error(`[watchlist] sync refused (HTTP ${res.status})`)
      return "rejected"
    }
    if (!res.ok) {
      console.error(`[watchlist] sync HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    if (!Array.isArray(data?.entries)) return null
    return {
      entries: data.entries as WireEntry[],
      rejected: Array.isArray(data.rejected) ? data.rejected : [],
    }
  } catch (e) {
    console.error("[watchlist] sync failed", e)
    return null
  }
}

/**
 * Load the server's list into the cache. Call once on app load, logged in.
 *
 * First run on a device (no owner recorded): everything held locally is
 * uploaded before the read, merging it into the account. A cache that belongs
 * to a different user is dropped, along with its queued changes. When the
 * server can't be reached the cache is left as it is.
 */
export async function hydrateWatchlist(userId: string): Promise<void> {
  if (typeof window === "undefined") return
  let owner: string | null = null
  try {
    owner = window.localStorage.getItem(OWNER_KEY)
  } catch {}

  if (owner === null) {
    markPending(
      readList().map((e) => e.rec.id),
      "upsert",
    )
  } else if (owner !== userId) {
    writeList([])
    writePending({})
    writeRemovals([])
  }
  try {
    window.localStorage.setItem(OWNER_KEY, userId)
  } catch {}
  // A fresh start for batch sizing: a split left over from an earlier,
  // never-drained queue shouldn't slow this load down.
  pushLimit = MAX_CHANGES_PER_PUSH

  const server = await pushPending()
  if (server === null) return
  // Another account took over this cache while the request was out (sign-out
  // and back in as someone else): this result belongs to the old one.
  try {
    if (window.localStorage.getItem(OWNER_KEY) !== userId) return
  } catch {}

  // Server is the truth, except for changes queued after the push was sent.
  const local = new Map(readList().map((e) => [e.rec.id, e]))
  const pending = readPending()
  const merged = new Map<string, WatchlistEntry>()
  for (const s of server) {
    if (typeof s?.rec?.id !== "string" || pending[s.rec.id]) continue
    merged.set(s.rec.id, {
      rec: s.rec,
      explain: s.explain ?? null,
      rating: s.rating ?? null,
      added_at: s.added_at,
      // The fingerprint flag is per device: a title saved elsewhere was
      // reported (or will be) by the device that saved it.
      synced: local.get(s.rec.id)?.synced ?? true,
    })
  }
  for (const [id, p] of Object.entries(pending)) {
    const e = local.get(id)
    if (p.op === "upsert" && e) merged.set(id, e)
  }
  writeList(
    [...merged.values()].sort((a, b) => b.added_at - a.added_at).slice(0, MAX_ENTRIES),
  )
  window.dispatchEvent(new Event(WATCHLIST_HYDRATED_EVENT))
}
