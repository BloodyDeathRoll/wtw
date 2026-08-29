import { describe, it, expect } from 'vitest'
import { isContentType, titleTypeFor, type ContentType } from '@/lib/content-type'
import { recCacheKey } from '@/modules/engine/pipeline/step8-cache'

/**
 * Content type is a GENERATION input, not a display filter (2026-08-29).
 * Before that, a batch was built type-blind and filtered on the way out: on a
 * movie-dominant fingerprint a batch of 50 came back 46 movies / 4 series, and
 * after the judged/removed filters exactly ONE series was servable.
 *
 * The two things that have to hold: the candidate query filters by type, and
 * movies/series never share a cache entry.
 */

describe('titleTypeFor', () => {
  it('maps the toggle onto titles.type', () => {
    expect(titleTypeFor('movies')).toBe('movie')
    expect(titleTypeFor('series')).toBe('tv')
  })

  it('is null for "all" and for nothing — no filter, not an empty filter', () => {
    expect(titleTypeFor('all')).toBeNull()
    expect(titleTypeFor(undefined)).toBeNull()
    expect(titleTypeFor(null)).toBeNull()
  })
})

describe('isContentType', () => {
  it('accepts only the three values', () => {
    expect(isContentType('movies')).toBe(true)
    expect(isContentType('series')).toBe(true)
    expect(isContentType('all')).toBe(true)
    for (const bad of ['movie', 'tv', '', null, undefined, 0, {}]) {
      expect(isContentType(bad), String(bad)).toBe(false)
    }
  })
})

describe('recCacheKey', () => {
  it('gives movies and series separate entries at the same version', () => {
    const movies = recCacheKey('u1', 7, 'movies')
    const series = recCacheKey('u1', 7, 'series')
    expect(movies).not.toBe(series)
    expect(movies).toBe('rec:u1:7:movies')
    expect(series).toBe('rec:u1:7:series')
  })

  it('still separates users and taste versions', () => {
    expect(recCacheKey('u1', 7, 'movies')).not.toBe(recCacheKey('u2', 7, 'movies'))
    expect(recCacheKey('u1', 7, 'movies')).not.toBe(recCacheKey('u1', 8, 'movies'))
  })

  it('defaults to the "all" bucket rather than colliding with a typed one', () => {
    expect(recCacheKey('u1', 7)).toBe('rec:u1:7:all')
    const typed: ContentType[] = ['movies', 'series']
    for (const t of typed) expect(recCacheKey('u1', 7)).not.toBe(recCacheKey('u1', 7, t))
  })
})
