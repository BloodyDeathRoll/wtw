import type { DNASchema } from '@/types/dna'

// Signals older than this get confidence halved (product decision: 18 months)
const DECAY_THRESHOLD_MS = 18 * 30 * 24 * 60 * 60 * 1000
const DECAY_FACTOR = 0.5

/** The cutoff date the cron's SQL filter uses (`users_due_for_decay`, migration 0039): same rule as below. */
export function decayCutoff(now = Date.now()): string {
  return new Date(now - DECAY_THRESHOLD_MS).toISOString().slice(0, 10)
}

/**
 * Applies 18-month temporal decay to the user's DNA, per signal (#457, Eran's OK, 2026-11-26).
 *
 * Rules:
 * - A signal with watched_at older than 18 months and no `decayed_at` → confidence *= 0.5 and
 *   `decayed_at` = now: halved once, never twice. A signal that passes 18 months later is halved
 *   then. (Before #457 one per-DNA flag stopped the cron after its first decay, so later ratings
 *   never decayed, and a DNA with nothing to decay was re-read whole every night.)
 * - Crew affinity: the first time a DNA decays at all, if it has no recent signal, every crew
 *   entry's confidence *= 0.5 (the score itself is kept — we still know their taste, with less
 *   certainty). Once per DNA, as before: `temporal_decay_applied` records it.
 * - Returns how many signals it halved. Caller must bumpVersion + save when that's > 0.
 */
export function applyTemporalDecay(dna: DNASchema, now = Date.now()): number {
  const stamp = new Date(now).toISOString()
  let decayedCount = 0
  let anyRecent = false

  for (const signal of dna.signals) {
    if (!signal.watched_at) continue
    const watched = new Date(signal.watched_at).getTime()
    if (Number.isNaN(watched)) continue
    if (now - watched <= DECAY_THRESHOLD_MS) { anyRecent = true; continue }
    if (signal.decayed_at) continue
    signal.confidence = signal.confidence * DECAY_FACTOR
    signal.decayed_at = stamp
    decayedCount++
  }

  if (decayedCount === 0) return 0

  // Crew: only with no recent watch at all (we can't trace which signals back which crew member
  // without a join, so the title's watch recency stands in), and only on the DNA's first decay.
  if (!anyRecent && !dna.learning_loop.temporal_decay_applied) {
    for (const bucket of ['directors', 'writers', 'cinematographers', 'actors'] as const) {
      for (const entry of Object.values(dna.strand_a_creative_affinity[bucket])) {
        entry.confidence = entry.confidence * DECAY_FACTOR
      }
    }
  }

  dna.learning_loop.temporal_decay_applied = true
  return decayedCount
}
