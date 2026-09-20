/**
 * The most recent slice of a conversation that fits a message and character
 * budget, oldest-first.
 *
 * Two places need this and they arrived at it independently (2026-09-20):
 *
 *   - `/api/conversation/message` bounds what one chat turn costs. It used to
 *     enforce that by refusing with a 413, which locked users out of their own
 *     conversation once it passed 60 messages.
 *   - `analyzeSession` bounds what one session-end extraction reads. It had no
 *     bound at all, and a 107-message account exceeded the client's 45s
 *     timeout.
 *
 * Both want the same thing, so they share it rather than drifting.
 *
 * Most-recent is the right end to keep. For the chat, the recent turns are what
 * the next question follows from. For extraction, older turns were already
 * extracted at an earlier session end, and a title the user already has an
 * opinion on is deduped on merge.
 *
 * The newest item is ALWAYS kept, however long it is. Checking its size first
 * would let one pasted wall of text return nothing — and nothing is
 * indistinguishable from "the user said nothing", which is the
 * failure-looks-like-silence ambiguity the session work spent this release
 * removing.
 */
export function boundedTail<T>(
  items: readonly T[],
  textOf: (item: T) => string,
  maxItems: number,
  maxChars: number,
): T[] {
  const kept: T[] = []
  let chars = 0
  for (let i = items.length - 1; i >= 0; i--) {
    if (kept.length >= maxItems) break
    const len = textOf(items[i]).length
    if (kept.length > 0 && chars + len > maxChars) break
    kept.push(items[i])
    chars += len
  }
  return kept.reverse()
}
