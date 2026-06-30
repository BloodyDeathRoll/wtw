import type { Reaction } from '@/types/dna'

export const REACTION_SCORE: Record<Reaction, number> = {
  loved:    +0.30,
  liked:    +0.15,
  mixed:    -0.05,
  disliked: -0.20,
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Confidence delta — larger bump when signal corroborates existing score direction
export function confidenceDelta(existingScore: number, reactionScore: number): number {
  const sameDirection =
    (existingScore >= 0 && reactionScore >= 0) ||
    (existingScore  < 0 && reactionScore  < 0)
  return sameDirection ? +0.08 : -0.04
}

export function lineageBoost(score: number): 'none' | 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  if (score >= 0.1) return 'low'
  return 'none'
}
