import { describe, it, expect } from 'vitest'
import { genres16Of, GENRES_16, GENRE_13_OF } from '@/app/play/lib/genres16'
import { GAME_GENRES } from '@/app/play/lib/genres'

const movie = (genres: string[], keywords: string[] = [], lang = 'en') =>
  ({ type: 'movie' as const, genres: genres.map(name => ({ name })), keywords, original_language: lang })
const tv = (genres: string[], keywords: string[] = [], lang = 'en') =>
  ({ type: 'tv' as const, genres: genres.map(name => ({ name })), keywords, original_language: lang })

describe('genres16Of: the 16 genres people choose', () => {
  it('puts superhero titles under Superheroes only, never Sci-fi or Fantasy', () => {
    expect(genres16Of(movie(['Action', 'Science Fiction', 'Adventure'], ['superhero', 'based on comic']))).toEqual(['action', 'hero'])
    expect(genres16Of(movie(['Drama', 'Action', 'Crime', 'Thriller'], ['superhero', 'dc comics']))).toEqual(['drama', 'action', 'crime', 'thriller', 'hero'])
  })

  it('keeps Sci-fi and Fantasy apart for movies', () => {
    expect(genres16Of(movie(['Adventure', 'Drama', 'Science Fiction']))).toEqual(['drama', 'scifi'])
    expect(genres16Of(movie(['Adventure', 'Fantasy']))).toEqual(['fantasy'])
  })

  it('tells TV "Sci-Fi & Fantasy" apart by keywords, and counts it as both when they say nothing', () => {
    expect(genres16Of(tv(['Sci-Fi & Fantasy', 'Drama'], ['dragon', 'medieval']))).toEqual(['drama', 'fantasy'])
    expect(genres16Of(tv(['Sci-Fi & Fantasy', 'Mystery'], ['time travel']))).toEqual(['thriller', 'scifi'])
    expect(genres16Of(tv(['Sci-Fi & Fantasy']))).toEqual(['scifi', 'fantasy'])
  })

  it("splits animation into adult and kids', and keeps anime its own", () => {
    expect(genres16Of(tv(['Animation', 'Comedy', 'Drama'], ['adult animation']))).toEqual(['comedy', 'drama', 'adultanim'])
    expect(genres16Of(movie(['Animation', 'Family', 'Comedy']))).toEqual(['comedy', 'anim'])
    expect(genres16Of(tv(['Animation', 'Action & Adventure'], ['anime'], 'ja'))).toEqual(['action', 'anime'])
  })

  it('keeps Family & kids live-action only', () => {
    expect(genres16Of(movie(['Family', 'Fantasy', 'Adventure']))).toEqual(['fantasy', 'family'])
    expect(genres16Of(movie(['Animation', 'Family']))).toEqual(['anim'])
    expect(genres16Of(tv(['Kids', 'Comedy']))).toEqual(['comedy', 'family'])
  })

  it('has 16 genres, each sitting on one of the 13', () => {
    expect(GENRES_16).toHaveLength(16)
    const ids13 = new Set(GAME_GENRES.map(g => g.id))
    for (const g of GENRES_16) expect(ids13.has(GENRE_13_OF[g.id]), g.id).toBe(true)
  })
})
