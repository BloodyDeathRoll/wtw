import { describe, it, expect } from 'vitest'
import {
  REACTION_SCORE,
  clamp,
  confidenceDelta,
  lineageBoost,
} from '@/modules/dna/lib/reaction-score'

// Pure DNA scoring primitives — the building blocks the review flagged bugs
// around (unbounded confidence, direction of confidence delta, etc.).
describe('clamp', () => {
  it('bounds a value to [min,max]', () => {
    expect(clamp(1.4, 0, 1)).toBe(1)
    expect(clamp(-0.3, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})

describe('confidenceDelta', () => {
  it('rewards a corroborating signal (same direction)', () => {
    expect(confidenceDelta(0.3, 0.15)).toBeGreaterThan(0)   // both positive
    expect(confidenceDelta(-0.3, -0.2)).toBeGreaterThan(0)  // both negative
  })

  it('penalises a contradicting signal (opposite direction)', () => {
    expect(confidenceDelta(0.3, -0.2)).toBeLessThan(0)
    expect(confidenceDelta(-0.3, 0.15)).toBeLessThan(0)
  })
})

describe('lineageBoost', () => {
  it('maps score bands to tiers', () => {
    expect(lineageBoost(0.8)).toBe('high')
    expect(lineageBoost(0.5)).toBe('medium')
    expect(lineageBoost(0.2)).toBe('low')
    expect(lineageBoost(0)).toBe('none')
    expect(lineageBoost(-0.5)).toBe('none')
  })
})

describe('REACTION_SCORE', () => {
  it('orders reactions loved > liked > disliked', () => {
    expect(REACTION_SCORE.loved).toBeGreaterThan(REACTION_SCORE.liked)
    expect(REACTION_SCORE.liked).toBeGreaterThan(REACTION_SCORE.disliked)
  })
})
