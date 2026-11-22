/**
 * Report Watchlist saves and unsaves to the fingerprint now (v3 Q6, POST /api/watchlist/saved), instead of waiting
 * for the next session end. Search's card calls it on Add / Remove (SEARCH.md DEC-4): a save there counts at once,
 * as a save from For you does at its next sync.
 *
 * It sends what's queued (getUnsyncedIds / getUnsyncedRemovals, the same queue /api/session/end reads) and marks it
 * reported only once the write landed. On any failure the queue stays as it was, so the next session end still
 * carries it. Ids that aren't "type:tmdb_id" (old saved cards) are left for the session end, which takes them as-is.
 * One call at a time: a second tap waits for the first, then sends what's left.
 */
import { getUnsyncedIds, getUnsyncedRemovals, markRemovalsSynced, markSynced } from "@/lib/watchlist";

const KEY = /^(movie|tv):\d+$/;
const MAX = 60;

let chain: Promise<boolean> = Promise.resolve(true);

export function reportSavesNow(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  chain = chain.then(() => send(fetchImpl), () => send(fetchImpl));
  return chain;
}

async function send(fetchImpl: typeof fetch): Promise<boolean> {
  const added = getUnsyncedIds().filter((k) => KEY.test(k)).slice(0, MAX);
  const removed = getUnsyncedRemovals().filter((k) => KEY.test(k)).slice(0, MAX);
  if (added.length === 0 && removed.length === 0) return true;
  try {
    const res = await fetchImpl("/api/watchlist/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ added, removed }),
    });
    if (!res.ok) return false;
    markSynced(added);
    markRemovalsSynced(removed);
    return true;
  } catch {
    return false;
  }
}

/** For the tests. */
export function resetReportSaves() {
  chain = Promise.resolve(true);
}
