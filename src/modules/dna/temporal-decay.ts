import type { DNASignal, DNAMetadata } from '@/types/dna'

/** Signals older than this many months are decayed */
const DECAY_THRESHOLD_MONTHS = 18

/** Decay multiplier applied to confidence */
const DECAY_FACTOR = 0.5

/** Minimum confidence floor after decay — prevents a signal from reaching zero */
const CONFIDENCE_FLOOR = 0.05

/** Decay is run at most once every N days to avoid repeated halving */
const DECAY_INTERVAL_DAYS = 30

/**
 * Applies temporal decay to signals older than DECAY_THRESHOLD_MONTHS.
 * Confidence is halved, floored at CONFIDENCE_FLOOR.
 * Signals with no watched_at are left untouched (we don't know when they were added).
 *
 * Pure function — returns a new array, does not mutate input.
 */
export function applyTemporalDecay(signals: DNASignal[]): DNASignal[] {
  const cutoff = monthsAgo(DECAY_THRESHOLD_MONTHS)

  return signals.map((signal) => {
    if (!signal.watched_at) return signal

    const watchedAt = new Date(signal.watched_at)
    if (isNaN(watchedAt.getTime())) return signal   // guard malformed dates

    if (watchedAt < cutoff) {
      return {
        ...signal,
        confidence: Math.max(
          signal.confidence * DECAY_FACTOR,
          CONFIDENCE_FLOOR,
        ),
      }
    }

    return signal
  })
}

/**
 * Returns true if decay should be run given the current metadata.
 * Decay is skipped if it was already applied within the last DECAY_INTERVAL_DAYS.
 */
export function shouldRunDecay(metadata: DNAMetadata): boolean {
  if (!metadata.last_updated) return true

  const lastUpdate = new Date(metadata.last_updated)
  if (isNaN(lastUpdate.getTime())) return true

  const daysSinceUpdate =
    (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)

  return daysSinceUpdate >= DECAY_INTERVAL_DAYS
}

// ─── helpers ────────────────────────────────────────────────────────────────

function monthsAgo(months: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d
}
