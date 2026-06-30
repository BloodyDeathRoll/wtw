import type { StrandC, Reaction } from '@/types/dna'
import { clamp } from './reaction-score'

type TitleMeta = {
  pacing_tag: string | null
  tone_tags:  string[]
}

const PACING_DELTA: Record<Reaction, number> = {
  loved:    +0.04,
  liked:    +0.02,
  mixed:    -0.01,
  disliked: -0.02,
}

const TONE_DELTA: Record<Reaction, number> = {
  loved:    +0.03,
  liked:    +0.015,
  mixed:    -0.005,
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
}
