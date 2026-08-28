import type { StrandC, Reaction } from '@/types/dna'
import { clamp } from './reaction-score'

type TitleMeta = {
  pacing_tag: string | null
  tone_tags:  string[]
}

const PACING_DELTA: Record<Reaction, number> = {
  loved:    +0.04,
  liked:    +0.02,
  disliked: -0.02,
}

const TONE_DELTA: Record<Reaction, number> = {
  loved:    +0.03,
  liked:    +0.015,
  disliked: -0.015,
}

const VALID_PACING = new Set(['slow_burn', 'moderate', 'high_octane'])
const VALID_TONES  = new Set(['cynical', 'warm', 'dark', 'comedic', 'hopeful'])

export function applyStrandCUpdate(
  strand_c: StrandC,
  title: TitleMeta,
  reaction: Reaction,
): void {
  // Pacing
  const pDelta = PACING_DELTA[reaction]
  if (title.pacing_tag && VALID_PACING.has(title.pacing_tag)) {
    const key = title.pacing_tag as keyof typeof strand_c.pacing_weights
    strand_c.pacing_weights[key] = clamp(strand_c.pacing_weights[key] + pDelta, 0, 1)
  }

  // Tone
  const tDelta = TONE_DELTA[reaction]
  for (const tag of title.tone_tags ?? []) {
    if (VALID_TONES.has(tag)) {
      const key = tag as keyof typeof strand_c.tone_weights
      strand_c.tone_weights[key] = clamp(strand_c.tone_weights[key] + tDelta, 0, 1)
    }
  }

  recenterWeights(strand_c.pacing_weights)
  recenterWeights(strand_c.tone_weights)
}

/**
 * Keep each weight group centred on 0.5. The deltas above only ever push a
 * tag UP on a loved/liked, so after a few hundred ratings every tone sat at
 * 0.97–1.0 (measured 2026-08-28: dark .97, comedic .985, hopeful 1.0) and
 * the scorer saw a user who "loves everything". What the weights mean is
 * relative — which tones the user favours over the others — so after each
 * update the group is shifted back toward a mean of 0.5. Differences between
 * tags are preserved; only the shared drift is removed. When the shift would
 * push a tag outside [0, 1] it is clamped, so the mean lands NEAR 0.5 rather
 * than on it ({1, 1, 0} → mean 0.56) — that residual is bounded and shrinks
 * on the next update, which is all that's needed to stop re-saturation.
 * `scripts/recenter-strand-c.mts` applied this once to existing rows.
 */
export function recenterWeights(weights: Record<string, number>): void {
  const keys = Object.keys(weights)
  if (keys.length === 0) return
  const mean = keys.reduce((s, k) => s + weights[k], 0) / keys.length
  const shift = mean - 0.5
  if (Math.abs(shift) < 1e-9) return
  for (const k of keys) weights[k] = clamp(weights[k] - shift, 0, 1)
}
