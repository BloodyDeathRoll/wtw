import type { DNASignal } from '@/types/dna'

/**
 * Merges new signals into the existing signals array.
 *
 * Rules:
 * - Append all new signals (signals are never deleted per schema contract)
 * - If a new signal's tmdb_id already exists in existing with an OPPOSITE reaction,
 *   flag both entries as 'contradicts_profile'
 * - Deduplicates by (tmdb_id + source): if the exact same source session already
 *   logged this title, skip the duplicate rather than double-counting
 */
export function mergeSignals(
  existing: DNASignal[],
  incoming: DNASignal[],
): DNASignal[] {
  // Build a lookup for fast contradiction detection
  const existingByTmdbId = new Map<string, DNASignal[]>()
  for (const s of existing) {
    const bucket = existingByTmdbId.get(s.tmdb_id) ?? []
    bucket.push(s)
    existingByTmdbId.set(s.tmdb_id, bucket)
  }

  // Build a dedup key set: tmdb_id + source
  const seenKeys = new Set(existing.map((s) => `${s.tmdb_id}::${s.source}`))

  const merged = [...existing]

  for (const signal of incoming) {
    const key = `${signal.tmdb_id}::${signal.source}`
    if (seenKeys.has(key)) continue   // exact duplicate — skip
    seenKeys.add(key)

    const priors = existingByTmdbId.get(signal.tmdb_id) ?? []
    const hasContradiction = priors.some(
      (p) => isOppositeReaction(p.reaction, signal.reaction),
    )

    if (hasContradiction) {
      // Flag all prior entries for this title
      for (const prior of merged) {
        if (prior.tmdb_id === signal.tmdb_id) {
          prior.flag = 'contradicts_profile'
        }
      }
      merged.push({ ...signal, flag: 'contradicts_profile' })
    } else {
      merged.push(signal)
    }

    // Update lookup for subsequent iterations
    const bucket = existingByTmdbId.get(signal.tmdb_id) ?? []
    bucket.push(signal)
    existingByTmdbId.set(signal.tmdb_id, bucket)
  }

  return merged
}

/**
 * Returns true when two reactions are clearly opposed.
 * loved ↔ disliked  and  liked ↔ disliked are contradictions.
 * mixed is not considered a hard contradiction with anything.
 */
function isOppositeReaction(
  a: DNASignal['reaction'],
  b: DNASignal['reaction'],
): boolean {
  const opposites: Record<string, string[]> = {
    loved:    ['disliked'],
    liked:    ['disliked'],
    disliked: ['loved', 'liked'],
  }
  return opposites[a]?.includes(b) ?? false
}
