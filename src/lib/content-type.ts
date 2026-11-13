/**
 * What the Movies/Series toggle selects. It is a GENERATION input, not a
 * display filter: a batch is built for one content type, cached under it, and
 * regenerated when the user switches (see step8-cache.ts).
 */
export type ContentType = 'movies' | 'series' | 'all'

/** The `titles.type` value a content type maps to, or null for no filter. */
export function titleTypeFor(contentType: ContentType | null | undefined): 'movie' | 'tv' | null {
  if (contentType === 'movies') return 'movie'
  if (contentType === 'series') return 'tv'
  return null
}

/**
 * The list the feed opens on until the person picks one (Eran, 2026-11-13: "Both"). WTWApp starts there, and the
 * onboarding has its first feed built for it, so the batch made while they answer is the one they see.
 */
export const FEED_START_TYPE: ContentType = 'all'

export function isContentType(v: unknown): v is ContentType {
  return v === 'movies' || v === 'series' || v === 'all'
}
