/**
 * regret-queue.ts
 *
 * localStorage-backed queue of watched titles pending the 48-hour regret check.
 *
 * Flow:
 *   1. User marks a title as watched in RecCard → addToRegretQueue()
 *   2. On app load / feed render → getPendingRegretChecks()
 *   3. User responds to prompt → markRegretReacted() + fire feedback API
 */

const STORAGE_KEY = "wtw_regret_queue"
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000

export interface RegretEntry {
  tmdb_id: string
  title: string
  type: "movie" | "tv"
  watched_at: number  // Unix timestamp (ms)
  reacted: boolean
}

function readQueue(): RegretEntry[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
  } catch {
    return []
  }
}

function writeQueue(queue: RegretEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

/**
 * Entries are identified by (tmdb_id, type), never tmdb_id alone: TMDB numbers
 * movies and TV separately and the ranges collide (1396 is both a film and
 * Breaking Bad). On a bare-id match a queued film would suppress the series'
 * check-in — and answering one would silently mark the other reacted. Same class
 * of bug as the candidate-exclusion fix in migration 0014.
 */
function sameTitle(e: RegretEntry, tmdb_id: string, type: "movie" | "tv"): boolean {
  return e.tmdb_id === tmdb_id && e.type === type
}

/** Call when a user marks a title as watched. */
export function addToRegretQueue(tmdb_id: string, title: string, type: "movie" | "tv") {
  const queue = readQueue()
  if (queue.find(e => sameTitle(e, tmdb_id, type))) return  // already queued
  writeQueue([...queue, { tmdb_id, title, type, watched_at: Date.now(), reacted: false }])
}

/** Returns entries that are 48hr+ old and haven't had a regret response yet. */
export function getPendingRegretChecks(): RegretEntry[] {
  return readQueue().filter(e => !e.reacted && Date.now() - e.watched_at >= FORTY_EIGHT_HOURS)
}

/** Mark an entry as responded to so it stops surfacing. */
export function markRegretReacted(tmdb_id: string, type: "movie" | "tv") {
  writeQueue(
    readQueue().map(e => (sameTitle(e, tmdb_id, type) ? { ...e, reacted: true } : e)),
  )
}

/**
 * Dev/test helper — returns all unwatched entries regardless of age.
 * Used in the test page to simulate the 48hr prompt without waiting.
 */
export function getAllPendingForTesting(): RegretEntry[] {
  return readQueue().filter(e => !e.reacted)
}
