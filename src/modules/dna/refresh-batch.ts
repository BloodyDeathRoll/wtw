/**
 * Refresh the live batch mid-session, every N card ratings.
 *
 * Why (2026-09-06): a card rating deliberately does not bump `taste_version`,
 * because the rec cache is keyed by it and a bump with nothing cached under
 * the new version drops the feed to a cold regeneration — or, worse, to mocks.
 * The consequence was that a user could rate ten anime down in a row and keep
 * being served anime until they clicked "Find more", because the batch they
 * were scrolling was generated before any of it.
 *
 * The cost that made a bump expensive is already paid. `precomputeNextBatch`
 * runs after every rating and parks a fresh batch under `rec_pending` with a
 * hash of the inputs it was built from. So the refresh is not a generation at
 * all — it is the same promotion `session/end` does (`adoptPendingBatch`),
 * done earlier:
 *
 *   bump the version → adopt the parked batch as the cache for it → save.
 *
 * Agreed cache cost (A2/A3): **no extra generation, no extra rerank.** One
 * DNA read, one conditional write, and one Redis set per N ratings, plus an
 * embedding row update that only calls Mistral when the strand text actually
 * moved. "Find more" afterwards is usually a fast-path no-op instead of a
 * regeneration, so this is a net saving.
 *
 * Nothing is yanked out from under the user: the client appends pages and
 * dedups by id, so already-rendered cards stay and the next page comes from
 * the fresher batch.
 */

import { getRedis } from '@/lib/redis'
import { adoptPendingBatch } from '@/modules/engine/pipeline/precompute'
import { loadDNAForUpdate, saveDNAIfUnchanged, bumpVersion } from './lib/load-save'
import { regenerateEmbedding } from './lib/regenerate-embedding'
import type { ContentType } from '@/lib/content-type'

/**
 * How many ratings between refreshes. Small enough that a run of dislikes
 * reaches the feed within the same sitting, large enough that the feed is not
 * re-based under someone rating quickly.
 */
export const RATINGS_PER_REFRESH = 5

/** Long enough to span a sitting, short enough not to carry across days. */
const COUNTER_TTL_SECONDS = 6 * 60 * 60

const counterKey = (userId: string) => `rec_ratings_since_refresh:${userId}`

/**
 * Count this rating, and say whether it is the one that triggers a refresh.
 * Best-effort: if Redis is unreachable the answer is "no", and the batch
 * refreshes at session end as it always did.
 */
export async function countRatingTowardRefresh(userId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const n = await redis.incr(counterKey(userId))
    if (n === 1) await redis.expire(counterKey(userId), COUNTER_TTL_SECONDS)
    if (n < RATINGS_PER_REFRESH) return false
    await redis.del(counterKey(userId))
    return true
  } catch (err) {
    console.warn('[refresh-batch] rating counter unavailable (non-fatal):', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Promote the parked batch to the live cache under a bumped taste_version.
 * Returns the new version, or null when nothing changed.
 *
 * The version is only saved once the batch is safely cached under it. If
 * there is nothing parked, or it was built from inputs that have since moved,
 * the DNA is left exactly as it was — a bumped version with no cache behind it
 * is the one outcome worse than a stale batch.
 */
export async function refreshLiveBatch(
  userId: string,
  contentType: ContentType = 'all',
): Promise<number | null> {
  // Read updated_at alongside the DNA so the write below can be conditional.
  // This runs after the response, concurrently with whatever the user clicks
  // next — and a card rating is itself a read-modify-write of the same column
  // (merge-feedback-signal.ts, which compare-and-sets for the same reason).
  const row = await loadDNAForUpdate(userId)
  if (!row) return null
  const dna = row.dna
  bumpVersion(dna)

  // `generationInputsHash` covers signals, strands and rules — not metadata —
  // so bumping the version in memory first does not invalidate the parked
  // batch's hash. The adopt below still has to match on everything that
  // actually feeds a generation.
  const adopted = await adoptPendingBatch(userId, dna, contentType)
  if (!adopted) return null // nothing to promote — leave the fingerprint alone

  let saved: boolean
  try {
    saved = await saveDNAIfUnchanged(userId, dna, row.updated_at)
  } catch (err) {
    console.warn('[refresh-batch] save failed (non-fatal):', err instanceof Error ? err.message : err)
    return null
  }
  if (!saved) {
    // A rating landed while we were building. Its own precompute will park a
    // newer batch and the next refresh picks it up; the cache we just wrote
    // under the unsaved version is orphaned and expires on its own.
    console.log('[refresh-batch] skipped — fingerprint changed underneath')
    return null
  }

  // Only now, once the version is actually on disk. `fingerprint_embeddings`
  // is matched by exact taste_version (narrative-match.ts) precisely so a
  // stale vector can never score against the wrong taste — advancing that row
  // to a version the DNA never reached would reintroduce exactly that.
  //
  // Skips Mistral when the strand text is byte-identical (text_hash, migration
  // 0020), which it usually is: a handful of ratings rarely moves the dominant
  // pacing or the top two tones. Without it the next generation re-embeds from
  // scratch, which is the one real cost this whole path exists to avoid.
  await regenerateEmbedding(userId, dna).catch(err =>
    console.warn('[refresh-batch] embedding regen failed (non-fatal):', err instanceof Error ? err.message : err),
  )

  console.log(`[refresh-batch] live batch refreshed as v${dna.metadata.taste_version}`)
  return dna.metadata.taste_version
}
