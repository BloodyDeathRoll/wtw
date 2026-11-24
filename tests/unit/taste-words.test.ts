import { describe, it, expect } from 'vitest'
import { genreSays, scaleRows, summary, CALL_SAYS } from '@/app/profile/dna/lib/taste-words'

// P2-U8: the Taste DNA page's words come from what you rated and what the taste model learned.

describe('genreSays', () => {
  it('says what the ratings say, quieter when there is little to go on', () => {
    expect(genreSays({ loved: 0, liked: 0, disliked: 0 }, 'normal')).toEqual({ text: 'Nothing rated yet', thin: true })
    expect(genreSays({ loved: 0, liked: 0, disliked: 0 }, 'never')).toEqual({ text: 'Hidden from your feed', thin: true })
    expect(genreSays({ loved: 1, liked: 1, disliked: 0 }, 'normal')).toEqual({ text: 'Only 2 rated so far', thin: true })
    // Plain counts in Seen's words, a zero left out; never "Loved all N" or "enjoyed" (P2-G check 6).
    expect(genreSays({ loved: 7, liked: 0, disliked: 0 }, 'normal')).toEqual({ text: '7 loved', thin: false })
    expect(genreSays({ loved: 8, liked: 3, disliked: 0 }, 'normal').text).toBe('8 loved · 3 liked')
    expect(genreSays({ loved: 8, liked: 3, disliked: 1 }, 'normal').text).toBe('8 loved · 3 liked · 1 disliked')
    expect(genreSays({ loved: 3, liked: 2, disliked: 5 }, 'normal').text).toBe('3 loved · 2 liked · 5 disliked')
    expect(genreSays({ loved: 0, liked: 1, disliked: 5 }, 'normal').text).toBe('1 liked · 5 disliked')
    expect(genreSays({ loved: 0, liked: 0, disliked: 3 }, 'never').text).toBe('3 disliked')
  })
  it('the line under each step reads the same from any earlier step', () => {
    expect(CALL_SAYS.less('Comedy')).toBe('I want to see less Comedy in my feed.')
    expect(CALL_SAYS.normal('Comedy')).toBe('Let my ratings decide how much Comedy I see.')
  })
})

describe('scaleRows and summary', () => {
  // w[14..23] = commit, complex, dark, energy, fantastic, humor, indie, modern, pace, tone; w[24] audience
  const w = Array(25).fill(0)
  w[0] = 0.35
  w[16] = -0.3    // dark → light
  w[23] = 0.4     // tone → funny
  const sure = { scales: { dark: -0.8, tone: 0.9 }, comedy: false, series: false }
  const rated = Array(10).fill(sure)

  it('puts the clear leans first and hides dry wit and series length until there are comedies and series', () => {
    const rows = scaleRows(w, rated)
    expect(rows.slice(0, 2).map(r => [r.id, r.clear, r.lean > 0])).toEqual([['tone', true, true], ['dark', true, false]])
    expect(rows.some(r => r.id === 'humor' || r.id === 'commit')).toBe(false)
  })
  it('builds the sentence from the two leans, the best-liked genre, the crowd and the top person', () => {
    const rows = scaleRows(w, rated)
    expect(summary(rows, [{ label: 'Crime', tally: { loved: 5, liked: 1, disliked: 0 } }], w[0], 'Quentin Tarantino'))
      .toBe('You go for funny, light stories, with crime above all. You tend to love what everybody loves, and anything Quentin Tarantino makes.')
  })
  it('says nothing until two scales lean clearly', () => {
    expect(summary(scaleRows(Array(25).fill(0), rated), [], 0, null)).toBeNull()
  })
})
