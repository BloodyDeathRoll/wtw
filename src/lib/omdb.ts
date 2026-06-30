/**
 * WTW — OMDB API Client
 * Server-side only. Never import in client components.
 *
 * Used by fetchAndCacheTitle() to supplement TMDB ratings with
 * Rotten Tomatoes and Metacritic scores.
 *
 * Returns a single normalized float (0.0 – 1.0) stored as
 * titles.omdb_rating in Supabase.
 *
 * Weighting:
 *   Rotten Tomatoes  50%
 *   Metacritic       30%
 *   IMDb             20%
 *
 * Returns null if OMDB has no record (common for non-English titles).
 */

const BASE = 'https://www.omdbapi.com'

function apiKey() {
  const key = process.env.OMDB_API_KEY
  if (!key) throw new Error('OMDB_API_KEY is not set')
  return key
}

// ─────────────────────────────────────────────
// Raw OMDB response shape (only fields we use)
// ─────────────────────────────────────────────

interface OMDBRatingSource {
  Source: string   // 'Rotten Tomatoes' | 'Metacritic' | 'Internet Movie Database'
  Value: string    // '97%' | '74/100' | '8.5/10'
}

interface OMDBResponse {
  Response: 'True' | 'False'
  Error?: string
  Ratings?: OMDBRatingSource[]
  imdbRating?: string   // '8.5' or 'N/A'
  Metascore?: string    // '74' or 'N/A'
}

// ─────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────

function parsePercent(value: string): number | null {
  // '97%' → 0.97
  const n = parseFloat(value.replace('%', ''))
  return isNaN(n) ? null : n / 100
}

function parseSlash(value: string, denominator: number): number | null {
  // '74/100' → 0.74  |  '8.5/10' → 0.85
  const [num] = value.split('/')
  const n = parseFloat(num)
  return isNaN(n) ? null : n / denominator
}

function parseRatings(ratings: OMDBRatingSource[], imdbRating?: string, metascore?: string): number | null {
  let rt: number | null = null
  let meta: number | null = null
  let imdb: number | null = null

  for (const r of ratings) {
    if (r.Source === 'Rotten Tomatoes') {
      rt = parsePercent(r.Value)
    } else if (r.Source === 'Metacritic') {
      meta = parseSlash(r.Value, 100)
    } else if (r.Source === 'Internet Movie Database') {
      imdb = parseSlash(r.Value, 10)
    }
  }

  // Fall back to top-level fields if Ratings array didn't include them
  if (imdb === null && imdbRating && imdbRating !== 'N/A') {
    imdb = parseFloat(imdbRating) / 10 || null
  }
  if (meta === null && metascore && metascore !== 'N/A') {
    meta = parseFloat(metascore) / 100 || null
  }

  // Need at least one score to return a value
  const available = [
    rt   !== null ? { score: rt,   weight: 0.50 } : null,
    meta !== null ? { score: meta, weight: 0.30 } : null,
    imdb !== null ? { score: imdb, weight: 0.20 } : null,
  ].filter(Boolean) as { score: number; weight: number }[]

  if (available.length === 0) return null

  // Re-normalize weights if some sources are missing
  const totalWeight = available.reduce((sum, s) => sum + s.weight, 0)
  const normalized = available.reduce(
    (sum, s) => sum + (s.score * s.weight) / totalWeight,
    0
  )

  return Math.round(normalized * 1000) / 1000  // 3 decimal places
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Fetch normalized ratings for a title by its IMDb ID.
 * Returns a float 0.0 – 1.0, or null if no record found.
 *
 * @param imdb_id  e.g. 'tt0137523'
 */
export async function getRatings(imdb_id: string): Promise<number | null> {
  const url = new URL(BASE)
  url.searchParams.set('apikey', apiKey())
  url.searchParams.set('i', imdb_id)
  url.searchParams.set('tomatoes', 'true')  // include RT score

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`OMDB ${res.status} for ${imdb_id}`)
  }

  const data: OMDBResponse = await res.json()

  if (data.Response === 'False') {
    // OMDB has no record for this ID — not an error, just no data
    return null
  }

  return parseRatings(data.Ratings ?? [], data.imdbRating, data.Metascore)
}
