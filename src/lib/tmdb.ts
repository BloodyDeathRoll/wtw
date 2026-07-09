/**
 * WTW — TMDB API Client
 * Server-side only. Never import in client components.
 *
 * Endpoints used by the recommendation engine:
 *   getMovie(tmdb_id)    → full movie detail + credits + external IDs in one call
 *   getTV(tmdb_id)       → full TV detail + credits + external IDs in one call
 *   getPerson(tmdb_id)   → person detail for lineage graph building
 *   discoverMovies(page) → paginated popular movies for seeding the titles cache
 *   discoverTV(page)     → paginated popular TV shows for seeding the titles cache
 *
 * All use ?append_to_response= to batch sub-requests and avoid rate limits.
 * TMDB rate limit: 40 requests / 10 seconds (free tier).
 *
 * Returns null on 404. Throws on all other errors.
 */

const BASE = 'https://api.themoviedb.org/3'

function apiKey() {
  const key = process.env.TMDB_API_KEY
  if (!key) throw new Error('TMDB_API_KEY is not set')
  return key
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('api_key', apiKey())
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 }, // always fresh — we do our own caching in Supabase
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TMDB ${res.status} on ${path}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ─────────────────────────────────────────────
// Raw TMDB response shapes (only fields we use)
// ─────────────────────────────────────────────

interface TMDBGenre {
  id: number
  name: string
}

interface TMDBCastMember {
  id: number
  name: string
  order: number
}

interface TMDBCrewMember {
  id: number
  name: string
  job: string
  department: string
}

interface TMDBCredits {
  cast: TMDBCastMember[]
  crew: TMDBCrewMember[]
}

interface TMDBExternalIds {
  imdb_id: string | null
}

// ─────────────────────────────────────────────
// Normalised crew shape (matches titles.crew JSONB)
// ─────────────────────────────────────────────

export interface TMDBCrewSnapshot {
  directors: { tmdb_person_id: string; name: string }[]
  writers: { tmdb_person_id: string; name: string }[]
  cinematographers: { tmdb_person_id: string; name: string }[]
  cast: { tmdb_person_id: string; name: string; order: number }[]
}

function normaliseCredits(credits: TMDBCredits, created_by?: { id: number; name: string }[]): TMDBCrewSnapshot {
  const crew = credits.crew

  const directors = crew
    .filter(c => c.department === 'Directing' && c.job === 'Director')
    .map(c => ({ tmdb_person_id: String(c.id), name: c.name }))

  // Writers: Screenplay, Writer, Story, Creator
  const writerJobs = new Set(['Screenplay', 'Writer', 'Story', 'Script', 'Author'])
  const writers = crew
    .filter(c => c.department === 'Writing' && writerJobs.has(c.job))
    .map(c => ({ tmdb_person_id: String(c.id), name: c.name }))

  // TV shows have a separate created_by field — merge in, deduplicate
  if (created_by?.length) {
    const existingIds = new Set(writers.map(w => w.tmdb_person_id))
    for (const creator of created_by) {
      const id = String(creator.id)
      if (!existingIds.has(id)) {
        writers.push({ tmdb_person_id: id, name: creator.name })
        existingIds.add(id)
      }
    }
  }

  const cinematographers = crew
    .filter(c => c.department === 'Camera' && c.job === 'Director of Photography')
    .map(c => ({ tmdb_person_id: String(c.id), name: c.name }))

  // Top 5 cast only — past that it's noise for scoring
  const cast = credits.cast
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
    .map(c => ({ tmdb_person_id: String(c.id), name: c.name, order: c.order }))

  return { directors, writers, cinematographers, cast }
}

// ─────────────────────────────────────────────
// Public return types
// ─────────────────────────────────────────────

export interface TMDBMovieDetail {
  tmdb_id: string
  title: string
  type: 'movie'
  synopsis: string
  genres: TMDBGenre[]
  release_year: number | null
  runtime_minutes: number | null
  tmdb_rating: number       // 0.0 – 10.0
  tmdb_vote_count: number
  imdb_id: string | null    // for OMDB lookup
  poster_path: string | null // TMDB relative path, e.g. '/abc.jpg'
  crew: TMDBCrewSnapshot
}

export interface TMDBTVDetail {
  tmdb_id: string
  title: string
  type: 'tv'
  synopsis: string
  genres: TMDBGenre[]
  release_year: number | null
  runtime_minutes: number | null  // first_episode_run_time or median
  tmdb_rating: number
  tmdb_vote_count: number
  imdb_id: string | null
  poster_path: string | null // TMDB relative path, e.g. '/abc.jpg'
  crew: TMDBCrewSnapshot
}

/**
 * Build a full TMDB poster URL from the stored relative path.
 * Single source of truth for the image CDN base + size — callers pass
 * `titles.poster_path` and get a ready-to-render URL (or null to fall back).
 */
export function tmdbPosterUrl(
  poster_path: string | null | undefined,
  size: 'w342' | 'w500' | 'w780' | 'original' = 'w500',
): string | null {
  return poster_path ? `https://image.tmdb.org/t/p/${size}${poster_path}` : null
}

export interface TMDBDiscoverItem {
  tmdb_id: string
  title: string
  type: 'movie' | 'tv'
}

export interface TMDBPersonDetail {
  tmdb_person_id: string
  name: string
  known_for_department: string  // 'Directing' | 'Writing' | 'Camera' | 'Acting'
  known_for: { tmdb_id: string; title: string; type: 'movie' | 'tv' }[]
}

// ─────────────────────────────────────────────
// API methods
// ─────────────────────────────────────────────

/**
 * Fetch full movie detail including credits and external IDs.
 * Uses append_to_response to make a single HTTP request.
 */
export async function getMovie(tmdb_id: string): Promise<TMDBMovieDetail | null> {
  const raw = await tmdbFetch<{
    id: number
    title: string
    overview: string
    genres: TMDBGenre[]
    release_date: string        // 'YYYY-MM-DD'
    runtime: number | null
    vote_average: number
    vote_count: number
    poster_path: string | null
    credits: TMDBCredits
    external_ids: TMDBExternalIds
  }>(`/movie/${tmdb_id}`, { append_to_response: 'credits,external_ids' })

  if (!raw) return null

  return {
    tmdb_id: String(raw.id),
    title: raw.title,
    type: 'movie',
    synopsis: raw.overview ?? '',
    genres: raw.genres,
    release_year: raw.release_date ? parseInt(raw.release_date.slice(0, 4), 10) : null,
    runtime_minutes: raw.runtime ?? null,
    tmdb_rating: raw.vote_average,
    tmdb_vote_count: raw.vote_count,
    imdb_id: raw.external_ids?.imdb_id ?? null,
    poster_path: raw.poster_path ?? null,
    crew: normaliseCredits(raw.credits),
  }
}

/**
 * Fetch full TV show detail including credits and external IDs.
 */
export async function getTV(tmdb_id: string): Promise<TMDBTVDetail | null> {
  const raw = await tmdbFetch<{
    id: number
    name: string
    overview: string
    genres: TMDBGenre[]
    first_air_date: string      // 'YYYY-MM-DD'
    episode_run_time: number[]  // e.g. [42] or [25, 30]
    vote_average: number
    vote_count: number
    poster_path: string | null
    created_by: { id: number; name: string }[]
    credits: TMDBCredits
    external_ids: TMDBExternalIds
  }>(`/tv/${tmdb_id}`, { append_to_response: 'credits,external_ids' })

  if (!raw) return null

  // Use first episode runtime; fall back to null if unknown
  const runtimes = raw.episode_run_time ?? []
  const runtime_minutes = runtimes.length > 0 ? runtimes[0] : null

  return {
    tmdb_id: String(raw.id),
    title: raw.name,
    type: 'tv',
    synopsis: raw.overview ?? '',
    genres: raw.genres,
    release_year: raw.first_air_date ? parseInt(raw.first_air_date.slice(0, 4), 10) : null,
    runtime_minutes,
    tmdb_rating: raw.vote_average,
    tmdb_vote_count: raw.vote_count,
    imdb_id: raw.external_ids?.imdb_id ?? null,
    poster_path: raw.poster_path ?? null,
    crew: normaliseCredits(raw.credits, raw.created_by),
  }
}

/**
 * Fetch person detail for building the lineage graph.
 * known_for returns up to 3 notable titles.
 */
export async function getPerson(tmdb_person_id: string): Promise<TMDBPersonDetail | null> {
  const raw = await tmdbFetch<{
    id: number
    name: string
    known_for_department: string
    known_for: {
      id: number
      title?: string       // movie
      name?: string        // tv
      media_type: 'movie' | 'tv'
    }[]
  }>(`/person/${tmdb_person_id}`)

  if (!raw) return null

  return {
    tmdb_person_id: String(raw.id),
    name: raw.name,
    known_for_department: raw.known_for_department,
    known_for: (raw.known_for ?? []).map(kf => ({
      tmdb_id: String(kf.id),
      title: kf.title ?? kf.name ?? '',
      type: kf.media_type,
    })),
  }
}

/**
 * Paginated popular movies for seeding the titles cache.
 * Returns an array of { tmdb_id, title, type } — caller passes each to fetchAndCacheTitle.
 */
export async function discoverMovies(page = 1): Promise<TMDBDiscoverItem[]> {
  const raw = await tmdbFetch<{
    results: { id: number; title: string }[]
  }>('/discover/movie', {
    sort_by: 'popularity.desc',
    'vote_count.gte': '200',   // skip micro-budget obscurities
    page: String(page),
  })

  if (!raw) return []

  return raw.results.map(r => ({
    tmdb_id: String(r.id),
    title: r.title,
    type: 'movie',
  }))
}

/**
 * Search TMDB for a title by name and resolve it to a tmdb_id.
 * Used by the Session Brain to turn a film/show mentioned in conversation
 * into a real TMDB id so it can become a DNASignal.
 *
 * `type` narrows the search endpoint; omit to search both and take the
 * most popular match across movies + TV.
 * Returns null when TMDB has no match.
 */
export async function searchTitle(
  name: string,
  type?: 'movie' | 'tv',
): Promise<TMDBDiscoverItem | null> {
  const query = name.trim()
  if (!query) return null

  const endpoints: ('movie' | 'tv')[] = type ? [type] : ['movie', 'tv']
  let best: { tmdb_id: string; title: string; type: 'movie' | 'tv'; popularity: number } | null = null

  for (const kind of endpoints) {
    const raw = await tmdbFetch<{
      results: { id: number; title?: string; name?: string; popularity?: number }[]
    }>(`/search/${kind}`, { query, page: '1' })

    const top = raw?.results?.[0]
    if (!top) continue

    const popularity = top.popularity ?? 0
    if (!best || popularity > best.popularity) {
      best = {
        tmdb_id: String(top.id),
        title: top.title ?? top.name ?? query,
        type: kind,
        popularity,
      }
    }
  }

  if (!best) return null
  return { tmdb_id: best.tmdb_id, title: best.title, type: best.type }
}

/**
 * Paginated popular TV shows for seeding the titles cache.
 */
export async function discoverTV(page = 1): Promise<TMDBDiscoverItem[]> {
  const raw = await tmdbFetch<{
    results: { id: number; name: string }[]
  }>('/discover/tv', {
    sort_by: 'popularity.desc',
    'vote_count.gte': '100',
    page: String(page),
  })

  if (!raw) return []

  return raw.results.map(r => ({
    tmdb_id: String(r.id),
    title: r.name,
    type: 'tv',
  }))
}
