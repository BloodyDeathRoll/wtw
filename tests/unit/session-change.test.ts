import { describe, it, expect } from 'vitest'
import { hasMaterialChange } from '@/modules/session/session-change'
import type { SessionSummary, DNASignal } from '@/types/dna'

// Guards the /api/session/end no-op fast path (the "Find more" slowness fix):
// a summary with nothing to merge must return false so the route skips the
// version bump + cold pipeline; anything real must return true.

function emptySummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_number: 1,
    new_signals: [],
    dimension_updates: {},
    open_questions_resolved: [],
    new_open_questions: [],
    recommendation_made: null,
    recommendation_accepted: null,
    ...overrides,
  }
}

const signal = { tmdb_id: '42', title: 'X' } as unknown as DNASignal

describe('hasMaterialChange', () => {
  it('is false for an empty summary (the no-op "Find more" case)', () => {
    expect(hasMaterialChange(emptySummary())).toBe(false)
  })

  it('is true when there are new signals (incl. folded card ratings)', () => {
    expect(hasMaterialChange(emptySummary({ new_signals: [signal] }))).toBe(true)
  })

  it('is true when dimension_updates is non-empty', () => {
    expect(
      hasMaterialChange(
        emptySummary({
          dimension_updates: {
            moral_ambiguity: { value: 'high', confidence: 0.5, notes: '' },
          },
        }),
      ),
    ).toBe(true)
  })

  it('is true when open questions are resolved', () => {
    expect(hasMaterialChange(emptySummary({ open_questions_resolved: ['q1'] }))).toBe(true)
  })

  it('is true when new open questions are added', () => {
    expect(hasMaterialChange(emptySummary({ new_open_questions: ['q2'] }))).toBe(true)
  })

  it('is true when a recommendation was made (defensive — always null today)', () => {
    expect(hasMaterialChange(emptySummary({ recommendation_made: 'tt123' }))).toBe(true)
  })
})
