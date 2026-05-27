import type { StrandC, DNASignal } from '@/types/dna'

/**
 * Per-reaction step sizes for weight adjustments.
 * Weights move slowly — large jumps from single signals would make the
 * fingerprint unstable in early sessions.
 */
const WEIGHT_DELTA: Record<DNASignal['reaction'], number> = {
  loved:    0.06,
  liked:    0.03,
  mixed:    -0.01,
  disliked: -0.05,
}

/**
 * Maps StrandB dimension names → the StrandC pacing weight keys they
 * most directly influence. Signals that don't map to anything are ignored
 * for StrandC purposes (they only affect StrandB).
 */
const DIMENSION_TO_PACING: Partial<
  Record<string, keyof StrandC['pacing_weights']>
> = {
  narrative_complexity: 'slow_burn',
  emotional_demand:     'slow_burn',
}

const DIMENSION_TO_TONE: Partial<
  Record<string, keyof StrandC['tone_weights']>
> = {
  moral_ambiguity: 'dark',
  humor_style:     'comedic',
}

/**
 * Updates Strand C (visceral specs) based on new signals.
 *
 * Pure function — returns an updated StrandC, does not mutate input.
 *
 * StrandC weights are normalised floats [0.0, 1.0].
 * Positive reactions nudge associated weights up; negative reactions nudge down.
 */
export function updateStrandC(
  current: StrandC,
  signals: DNASignal[],
): StrandC {
  const updated: StrandC = {
    pacing_weights: { ...current.pacing_weights },
    tone_weights:   { ...current.tone_weights },
    aspect_weights: { ...current.aspect_weights },
  }

  for (const signal of signals) {
    const delta = WEIGHT_DELTA[signal.reaction]

    for (const dim of signal.dimensions_reinforced) {
      const pacingKey = DIMENSION_TO_PACING[dim]
      if (pacingKey) {
        updated.pacing_weights[pacingKey] = clamp(
          updated.pacing_weights[pacingKey] + delta,
        )
      }
      const toneKey = DIMENSION_TO_TONE[dim]
      if (toneKey) {
        updated.tone_weights[toneKey] = clamp(
          updated.tone_weights[toneKey] + delta,
        )
      }
    }

    for (const dim of signal.dimensions_contradicted) {
      const pacingKey = DIMENSION_TO_PACING[dim]
      if (pacingKey) {
        updated.pacing_weights[pacingKey] = clamp(
          updated.pacing_weights[pacingKey] - delta,
        )
      }
      const toneKey = DIMENSION_TO_TONE[dim]
      if (toneKey) {
        updated.tone_weights[toneKey] = clamp(
          updated.tone_weights[toneKey] - delta,
        )
      }
    }
  }

  return updated
}

/**
 * Directly sets aspect weights from the deep 12-dimension survey.
 * Called only when the user completes the opt-in survey — not every session.
 *
 * Pure function.
 */
export function applyAspectSurvey(
  current: StrandC,
  surveyWeights: Partial<StrandC['aspect_weights']>,
): StrandC {
  return {
    ...current,
    aspect_weights: {
      ...current.aspect_weights,
      ...Object.fromEntries(
        Object.entries(surveyWeights).map(([k, v]) => [k, clamp(v as number)]),
      ),
    },
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(Math.max(v, min), max)
}
