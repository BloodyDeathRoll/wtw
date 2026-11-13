import { describe, it, expect } from 'vitest'
import { genre16Rule, genre16Of, isExcluded, matchesRule, ruleTargets, sqlExclusionParams, type MatchableTitle } from '@/lib/exclusion-rules'

// "Never" picked on the 16-genre screen means exactly what the screen says (docs/plan/genres-16.md, option A).
const t = (genres: string[], keywords: string[] = [], original_language = 'en'): MatchableTitle =>
  ({ genres: genres.map(name => ({ name })), keywords, original_language })

const avengers = t(['Science Fiction', 'Action', 'Adventure'], ['superhero', 'marvel cinematic universe (mcu)'])
const interstellar = t(['Adventure', 'Drama', 'Science Fiction'], ['space travel'])
const lotr = t(['Adventure', 'Fantasy', 'Action'], ['elves', 'orcs'])
const toyStory = t(['Animation', 'Family', 'Comedy'])
const bojack = t(['Animation', 'Comedy', 'Drama'], ['adult animation'])
const jumanji = t(['Adventure', 'Fantasy', 'Family'])
const naruto = t(['Animation', 'Action & Adventure'], ['anime'], 'ja')

describe('Nevers from the 16-genre screen', () => {
  it('Superheroes hides superhero titles only', () => {
    const r = genre16Rule('hero')
    expect([avengers, interstellar, lotr].map(x => matchesRule(x, r))).toEqual([true, false, false])
  })

  it('Sci-fi and Fantasy hide their own titles, and neither hides a superhero film', () => {
    expect([avengers, interstellar, lotr].map(x => matchesRule(x, genre16Rule('scifi')))).toEqual([false, true, false])
    expect([avengers, interstellar, lotr].map(x => matchesRule(x, genre16Rule('fantasy')))).toEqual([false, false, true])
  })

  it("Kids' animation and Adult animation don't hide each other, or anime", () => {
    expect([toyStory, bojack, naruto].map(x => matchesRule(x, genre16Rule('anim')))).toEqual([true, false, false])
    expect([toyStory, bojack, naruto].map(x => matchesRule(x, genre16Rule('adultanim')))).toEqual([false, true, false])
  })

  it('Family & kids is live-action only', () => {
    expect([jumanji, toyStory].map(x => matchesRule(x, genre16Rule('family')))).toEqual([true, false])
  })

  it('keeps the readable label as the name, and is told apart by its id', () => {
    const r = genre16Rule('hero')
    expect(r).toMatchObject({ type: 'genre', name: 'Superheroes', raw: 'Never: Superheroes' })
    expect(genre16Of(r)).toBe('hero')
    expect(genre16Of({ id: 'play:never:horror' })).toBeNull()
  })

  it('gives the database pass only what cannot hide too much', () => {
    expect(ruleTargets(genre16Rule('hero')).keywords).toContain('superhero')
    expect(ruleTargets(genre16Rule('scifi'))).toMatchObject({ genres: [], keywords: [] })
    expect(sqlExclusionParams([genre16Rule('comedy')]).exclude_genres).toEqual(['comedy'])
  })

  it('leaves typed rules as they were', () => {
    const typed = { type: 'genre' as const, id: '', name: 'sci-fi', raw: '', reason: '' }
    expect(matchesRule(avengers, typed)).toBe(true)   // a typed "sci-fi" still means TMDB Science Fiction
    expect(isExcluded(interstellar, [typed])).toBe(true)
  })
})

// Review on #285 (2026-11-13): 105 of the 348 "adult animation" titles are anime. Sending that keyword to the
// database pass dropped them from the pool of someone who said Never to Adult animation and Love to Anime.
describe('Never: Adult animation leaves adult anime alone', () => {
  const adultAnime = t(['Animation', 'Action & Adventure', 'Drama'], ['adult animation', 'anime'], 'ja')
  it('sends nothing to the database pass, so the pool keeps the anime', () => {
    expect(ruleTargets(genre16Rule('adultanim'))).toMatchObject({ genres: [], keywords: [], languages: [] })
    expect(sqlExclusionParams([genre16Rule('adultanim')]).exclude_keywords).toEqual([])
  })
  it('the exact check still hides adult animation, and not adult anime', () => {
    expect(matchesRule(bojack, genre16Rule('adultanim'))).toBe(true)
    expect(matchesRule(adultAnime, genre16Rule('adultanim'))).toBe(false)
    expect(matchesRule(adultAnime, genre16Rule('anime'))).toBe(true)
  })
})
