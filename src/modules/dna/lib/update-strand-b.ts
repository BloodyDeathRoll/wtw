import type { StrandB, DNASignal } from '@/types/dna'

// Merge session brain's explicit dimension patch into current strand_b.
// The session brain's value wins if its confidence is >= current, otherwise
// we still corroborate by nudging current confidence up.
export function mergeStrandB(current: StrandB, updates: Partial<StrandB>): void {
  for (const key of Object.keys(updates) as (keyof StrandB)[]) {
    const patch = updates[key]
    if (!patch) continue

    if (patch.confidence >= current[key].confidence) {
      current[key].value      = patch.value
      current[key].confidence = patch.confidence
      if (patch.notes) current[key].notes = patch.notes
    } else {
      // Partial corroboration — bump confidence without changing value
      current[key].confidence = Math.min(1, current[key].confidence + 0.03)
    }
  }
}

// Update confidence from raw signal dimension tags produced by the session brain
export function applySignalDimensionTags(strand_b: StrandB, signals: DNASignal[]): void {
  const REINFORCE_DELTA  = +0.05
  const CONTRADICT_DELTA = -0.04

  for (const signal of signals) {
    for (const dim of signal.dimensions_reinforced) {
      if (dim in strand_b) {
        strand_b[dim].confidence = Math.min(1, strand_b[dim].confidence + REINFORCE_DELTA)
      }
    }
    for (const dim of signal.dimensions_contradicted) {
      if (dim in strand_b) {
        strand_b[dim].confidence = Math.max(0, strand_b[dim].confidence + CONTRADICT_DELTA)
      }
    }
  }
}
