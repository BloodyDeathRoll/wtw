import { describe, it, expect } from 'vitest'
import { extractDirectivesFromText, canonicalTarget } from '@/modules/session/directive-patterns'

// 2026-09-06: standing instructions were only extracted by Mistral at session
// end, so while Mistral answered 429 the rule was never written and the chat
// still said "got it". These pin the in-turn patterns — and, more importantly,
// pin what they must REFUSE to extract, because a false rule silently hides
// content the user never asked to hide.

const names = (text: string) => extractDirectivesFromText(text).map(d => d.name)
const one = (text: string) => {
  const d = extractDirectivesFromText(text)
  expect(d).toHaveLength(1)
  return d[0]
}

describe('in-turn directives — absolute instructions', () => {
  it.each([
    'no horror',
    'no horror please',
    'No more horror!',
    'never show me horror',
    'never recommend me horror films',
    'stop showing me horror',
    "don't show me any more horror",
    'I never want to see another horror movie',
    'I hate horror',
    "I can't stand horror",
  ])('reads %j as an exclusion', text => {
    const d = one(text)
    expect(d.kind).toBe('exclusion')
    expect(d.name).toBe('horror')
    expect(d.target_type).toBe('genre')
  })

  it('keeps the user’s own words as the reason it can be undone later', () => {
    const d = one('no horror please')
    expect(d.raw).toBe('no horror please')
    expect(d.weight_modifier).toBeUndefined()
  })
})

describe('in-turn directives — hedges', () => {
  it.each([
    'less romance',
    'a bit less romance',
    'fewer romances',
    'not really in the mood for romance',
    'not into romance',
    "I'm not a big fan of romance",
  ])('reads %j as a soft preference', text => {
    const d = one(text)
    expect(d.kind).toBe('soft_preference')
    expect(d.name).toBe('romance')
    expect(d.weight_modifier).toBe(0.5)
  })
})

describe('in-turn directives — what the catalog can match', () => {
  it('recognises anime, which is not a TMDB genre', () => {
    const d = one('no anime')
    expect(d.name).toBe('anime')
    expect(d.target_type).toBe('keyword')
  })

  it.each([
    ['no documentaries', 'documentary'],
    ['no comedies', 'comedy'],
    ['no mysteries', 'mystery'],
    ['no romances', 'romance'],
    ['no westerns', 'western'],
    ['no thrillers', 'thriller'],
    ['no musicals', 'music'],
    ['no sci-fi', 'science fiction'],
    ['no rom-coms', 'romance'],
    ['no reality tv', 'reality'],
    ['no k-drama', 'k-drama'],
  ])('normalises %j to %j', (text, expected) => {
    expect(names(text)).toEqual([expected])
  })

  it('takes every target in one instruction', () => {
    expect(names('no horror or thrillers')).toEqual(['horror', 'thriller'])
  })

  it('takes an exclusion and a hedge from one message', () => {
    const d = extractDirectivesFromText('No anime. And maybe less romance.')
    expect(d.map(x => [x.kind, x.name])).toEqual([
      ['exclusion', 'anime'],
      ['soft_preference', 'romance'],
    ])
  })

  it('says a repeated instruction once', () => {
    expect(names('no horror, seriously no horror')).toEqual(['horror'])
  })
})

describe('in-turn directives — refusals', () => {
  it.each([
    'no, I love horror',
    'I have no interest in watching that',
    'no idea what to watch',
    'is there no way to skip this',
    'I watched a horror film last night',
    'horror is my favourite genre',
    'I loved Hereditary',
    'no more than two hours please',
  ])('extracts nothing from %j', text => {
    expect(extractDirectivesFromText(text)).toEqual([])
  })

  it('leaves people and franchises to the session-end extractor', () => {
    // A person needs a TMDB lookup to be matchable, and guessing a name from
    // free text is how you end up excluding a genre called "Sandler".
    expect(extractDirectivesFromText('nothing with Adam Sandler')).toEqual([])
    expect(extractDirectivesFromText('no more Marvel')).toEqual([])
  })

  it('does not read a bare "no" halfway through a sentence as the instruction', () => {
    expect(extractDirectivesFromText('I hate low-budget no-name horror')).toEqual([])
  })

  it('ignores an empty or whitespace turn', () => {
    expect(extractDirectivesFromText('')).toEqual([])
    expect(extractDirectivesFromText('   ')).toEqual([])
  })
})

describe('canonicalTarget', () => {
  it('strips the words around the thing itself', () => {
    expect(canonicalTarget('any more horror films at all')).toEqual({
      name: 'horror',
      target_type: 'genre',
    })
  })

  it('refuses a phrase that is a sentence, not a target', () => {
    expect(canonicalTarget('horror is fine by me')).toBeNull()
  })

  it('refuses something the catalog cannot be filtered on', () => {
    expect(canonicalTarget('boring stuff')).toBeNull()
  })
})
