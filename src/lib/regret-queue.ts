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

/** Call when a user marks a title as watched. */
export function addToRegretQueue(tmdb_id: string, title: string, type: "movie" | "tv") {
  const queue = readQueue()
  if (queue.find(e => e.tmdb_id === tmdb_id)) return  // already queued
  writeQueue([...queue, { tmdb_id, title, type, watched_at: Date.now(), reacted: false }])
}

/** Returns entries that are 48hr+ old and haven't had a regret response yet. */
export function getPendingRegretChecks(): RegretEntry[] {
  return readQueue().filter(e => !e.reacted && Date.now() - e.watched_at >= FORTY_EIGHT_HOURS)
}

/** Mark an entry as responded to so it stops surfacing. */
export function markRegretReacted(tmdb_id: string) {
  writeQueue(readQueue().map(e => e.tmdb_id === tmdb_id ? { ...e, reacted: true } : e))
}

/**
 * Dev/test helper — returns all unwatched entries regardless of age.
 * Used in the test page to simulate the 48hr prompt without waiting.
 */
export function getAllPendingForTesting(): RegretEntry[] {
  return readQueue().filter(e => !e.reacted)
}
