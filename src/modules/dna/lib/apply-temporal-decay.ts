import type { DNASchema } from '@/types/dna'

// Signals older than this get confidence halved (product decision: 18 months)
const DECAY_THRESHOLD_MS = 18 * 30 * 24 * 60 * 60 * 1000
const DECAY_FACTOR = 0.5

/**
 * Applies 18-month temporal decay to the user's DNA.
 *
 * Rules:
 * - Any signal with watched_at older than 18 months → confidence *= 0.5
 * - Any crew affinity entry where ALL supporting signals are old
 *   → confidence *= 0.5 (the score itself is preserved — we still know their taste,
 *   just with less certainty)
 * - Sets learning_loop.temporal_decay_applied = true
 * - Caller must bumpVersion + saveDNA after calling this
 */
export function applyTemporalDecay(dna: DNASchema): number {
  const now = Date.now()
  let decayedCount = 0

  // 1. Decay old signals
  for (const signal of dna.signals) {
    if (!signal.watched_at) continue
    const age = now - new Date(signal.watched_at).getTime()
    if (age > DECAY_THRESHOLD_MS) {
      signal.confidence = signal.confidence * DECAY_FACTOR
      decayedCount++
    }
  }

  // 2. Identify tmdb_ids of recently-watched titles (not decayed)
  const recentTmdbIds = new Set(
    dna.signals
      .filter(s => {
        if (!s.watched_at) return false
        return now - new Date(s.watched_at).getTime() <= DECAY_THRESHOLD_MS
      })
      .map(s => s.tmdb_id),
  )

  // 3. Decay crew affinity entries that have no recent supporting signals
  //    (We can't perfectly trace which signals map to which crew members without
  //    a join, so we use the title's watch recency as a proxy.)
  const oldTmdbIds = new Set(
    dna.signals
      .filter(s => {
        if (!s.watched_at) return false
        return now - new Date(s.watched_at).getTime() > DECAY_THRESHOLD_MS
      })
      .map(s => s.tmdb_id),
  )

  // Only decay crew entries if ALL their source titles are old
  // This requires cross-referencing — for now we use a heuristic:
  // decay crew confidence if no recent watches exist at all
  if (recentTmdbIds.size === 0 && oldTmdbIds.size > 0) {
    for (const bucket of ['directors', 'writers', 'cinematographers', 'actors'] as const) {
      for (const entry of Object.values(dna.strand_a_creative_affinity[bucket])) {
        entry.confidence = entry.confidence * DECAY_FACTOR
      }
    }
  }

  dna.learning_loop.temporal_decay_applied = true
  return decayedCount
}
