/**
 * P2-U4 · "It's Showtime", the closing screen (P2-U0 part 6, signed off 2026-11-12).
 *
 * It holds itself at least 3 s (Eran: even when the feed is ready sooner) and asks for the feed at the same time;
 * it moves on only when both are done. A fast feed waits for the timer; a slow one keeps the screen up: one quiet
 * line after 8 s, and the failed state ("Almost showtime" + Try again) on an error or after 30 s. Nothing in the
 * feed or the engine knows about the 3 seconds.
 */
export const HOLD_MS = 3000
export const SLOW_MS = 8000
export const FAIL_MS = 30000

export interface ShowtimeHooks { ready(): void; slow(): void; failed(): void }

/** Starts the clock and the feed request together. Returns a stop function (leaving the screen). */
export function runShowtime(feed: () => Promise<unknown>, on: ShowtimeHooks): () => void {
  let held = false, fed = false, over = false
  const timers: ReturnType<typeof setTimeout>[] = []
  const stop = () => { over = true; timers.forEach(clearTimeout) }
  const maybeReady = () => { if (held && fed && !over) { stop(); on.ready() } }
  const fail = () => { if (!over) { stop(); on.failed() } }
  timers.push(setTimeout(() => { held = true; maybeReady() }, HOLD_MS))
  timers.push(setTimeout(() => { if (!over) on.slow() }, SLOW_MS))
  timers.push(setTimeout(fail, FAIL_MS))
  feed().then(() => { fed = true; maybeReady() }, fail)
  return stop
}

/**
 * The fan: picks, newest first; then cards rated Loved, newest first; up to three. Laid out older-left, newest in
 * the middle, next-newest right (two: older left, newest right). Never Liked, Disliked or "Haven't seen".
 */
export function fanOf(picked: string[], loved: string[]): string[] {
  const ids: string[] = []
  for (const id of [...picked].reverse().concat([...loved].reverse())) if (!ids.includes(id) && ids.length < 3) ids.push(id)
  const order: Record<number, number[]> = { 0: [], 1: [0], 2: [1, 0], 3: [1, 0, 2] }
  return order[ids.length].map(i => ids[i])
}
