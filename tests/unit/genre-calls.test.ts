import { describe, it, expect } from 'vitest'
import { genreCalls, setGenreCall, releaseGameNever, turnedUpGenres, GENRE_CALL_WEIGHT } from '@/lib/genre-calls'
import { genre16Rule } from '@/lib/exclusion-rules'
import type { ExclusionRule, SoftPreference } from '@/types/dna'

// P2-U8: your call on each of the 16 genres, on the Taste DNA page.

const logic = (exclusion_rules: ExclusionRule[] = [], soft_preferences: SoftPreference[] = []) => ({ exclusion_rules, soft_preferences })
const playNever = (name: string): ExclusionRule => ({ type: 'genre', id: `play:never:${name}`, name, raw: `Never: ${name}`, reason: '' })

describe('genreCalls', () => {
  it('is Normal everywhere with no rules', () => {
    expect(new Set(Object.values(genreCalls(logic())))).toEqual(new Set(['normal']))
  })
  it('reads the page\'s own calls', () => {
    let l = logic()
    l = setGenreCall(l, 'comedy', 'much')
    l = setGenreCall(l, 'drama', 'more')
    l = setGenreCall(l, 'doc', 'less')
    l = setGenreCall(l, 'horror', 'never')
    const c = genreCalls(l)
    expect([c.comedy, c.drama, c.doc, c.horror, c.action]).toEqual(['much', 'more', 'less', 'never', 'normal'])
  })
  it('shows an older Never on every genre it hides', () => {
    const c = genreCalls(logic([playNever('science fiction'), playNever('animation')]))
    expect([c.scifi, c.hero, c.fantasy, c.anim, c.adultanim, c.anime]).toEqual(['never', 'never', 'normal', 'never', 'never', 'never'])
  })
  it('reads an older "Less of" by name', () => {
    expect(genreCalls(logic([], [{ signal: 'romance', weight_modifier: 0.5 }])).romance).toBe('less')
  })
})

describe('setGenreCall', () => {
  it('one call per genre: a new call replaces the old one', () => {
    let l = setGenreCall(logic(), 'comedy', 'never')
    l = setGenreCall(l, 'comedy', 'more')
    expect(l.exclusion_rules).toEqual([])
    expect(l.soft_preferences).toEqual([{ signal: 'Comedy', weight_modifier: GENRE_CALL_WEIGHT.more, target_type: 'genre', genre16: 'comedy' }])
    l = setGenreCall(l, 'comedy', 'normal')
    expect(l.soft_preferences).toEqual([])
  })
  it('taking back one genre of an older rule keeps the others it hid, each exactly', () => {
    const l = setGenreCall(logic([playNever('science fiction')]), 'hero', 'normal')
    expect(l.exclusion_rules).toEqual([genre16Rule('scifi')])
    const c = genreCalls(l)
    expect([c.scifi, c.hero]).toEqual(['never', 'normal'])
  })
  it('leaves rules about other things alone', () => {
    const person: ExclusionRule = { type: 'person', id: '1', name: 'Adam Sandler', raw: '', reason: '' }
    const l = setGenreCall(logic([person], [{ signal: 'zombie', weight_modifier: 0.5, target_type: 'keyword' }]), 'horror', 'never')
    expect(l.exclusion_rules).toEqual([person, genre16Rule('horror')])
    expect(l.soft_preferences).toHaveLength(1)
  })
})

describe('turnedUpGenres', () => {
  it('lists the genres turned up, not down', () => {
    const l = setGenreCall(setGenreCall(logic(), 'comedy', 'much'), 'doc', 'less')
    expect(turnedUpGenres(l.soft_preferences)).toEqual(['comedy'])
  })
})

describe('releaseGameNever', () => {
  it('takes the genre screen\'s Never back, and the 13-genre value it wrote', () => {
    const s = { gen: { horror: -9 }, onboarding: { genres16: { horror: 'never', comedy: 'love' } } }
    expect(releaseGameNever(s, 'horror')).toEqual({ gen: { horror: 0 }, onboarding: { genres16: { comedy: 'love' } } })
    expect(s.gen.horror).toBe(-9)
  })
  it('is null when the games never said Never to it', () => {
    expect(releaseGameNever({ gen: { comedy: 2 }, onboarding: { genres16: { comedy: 'love' } } }, 'comedy')).toBeNull()
  })
})
