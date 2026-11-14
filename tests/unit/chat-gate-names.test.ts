import { describe, it, expect } from 'vitest'
import { capitalisedRuns, titleCandidates } from '../../scripts/eval/names'

// The chat gate's reading aid (scripts/eval/chat-gate.mts, P3-G): which names an answer holds.

describe('capitalisedRuns', () => {
  it('finds titles and people, and skips a sentence\'s first word', () => {
    const runs = capitalisedRuns("If you liked Heat’s tension, Lord of the Rings is a stretch. Try Knives Out: Rian Johnson directed it. It runs 130 minutes.")
    expect(runs).toEqual(['Heat', 'Lord of the Rings', 'Try Knives Out', 'Rian Johnson'])
  })

  it('does not end a name on a joining word', () => {
    expect(capitalisedRuns('A night with Parasite and popcorn.')).toEqual(['Parasite'])
  })
})

describe('titleCandidates', () => {
  it('offers every shorter run, so a title is found inside a longer one', () => {
    expect(titleCandidates(['Try Knives Out'])).toEqual(['Try', 'Try Knives', 'Try Knives Out', 'Knives', 'Knives Out', 'Out'])
  })
})
