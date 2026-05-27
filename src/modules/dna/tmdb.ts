import type { DNASignal } from '@/types/dna'
import type { ResolvedCrew } from './strand-a-updater'

const TMDB_BASE = 'https://api.themoviedb.org/3'

/**
 * Resolves crew members for a batch of signals from the TMDB API.
 * Returns a Map keyed by the signal's tmdb_id → array of relevant crew.
 *
 * Only fetches each tmdb_id once (deduplicates the batch).
 * Silently skips titles that fail to resolve — the DNA write continues
 * without Strand A updates for those titles.
 */
export async function resolveCrew(
  signals: DNASignal[],
): Promise<Map<string, ResolvedCrew[]>> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    console.warn('[tmdb] TMDB_API_KEY not set — Strand A will not be updated')
    return new Map()
  }

  const result = new Map<string, ResolvedCrew[]>()

  // Deduplicate by tmdb_id
  const unique = [...new Map(signals.map((s) => [s.tmdb_id, s])).values()]

  await Promise.allSettled(
    unique.map(async (signal) => {
      try {
        const crew = await fetchCrew(signal.tmdb_id, signal.type, apiKey)
        result.set(signal.tmdb_id, crew)
      } catch (err) {
        console.warn(`[tmdb] Failed to resolve crew for ${signal.tmdb_id}:`, err)
      }
    }),
  )

  return result
}

// ─── internals ───────────────────────────────────────────────────────────────

async function fetchCrew(
  tmdbId: string,
  type: 'movie' | 'tv',
  apiKey: string,
): Promise<ResolvedCrew[]> {
  const endpoint =
    type === 'movie'
      ? `${TMDB_BASE}/movie/${tmdbId}/credits`
      : `${TMDB_BASE}/tv/${tmdbId}/credits`

  const res = await fetch(`${endpoint}?api_key=${apiKey}`)
  if (!res.ok) {
    throw new Error(`TMDB ${res.status} for ${tmdbId}`)
  }

  const data = await res.json() as TMDBCreditsResponse
  return extractCrew(data)
}

function extractCrew(credits: TMDBCreditsResponse): ResolvedCrew[] {
  const crew: ResolvedCrew[] = []

  // Directors and writers from crew list
  for (const member of credits.crew ?? []) {
    if (member.job === 'Director') {
      crew.push({ tmdb_id: String(member.id), name: member.name, role: 'director' })
    } else if (['Screenplay', 'Writer', 'Story'].includes(member.job)) {
      crew.push({ tmdb_id: String(member.id), name: member.name, role: 'writer' })
    } else if (member.job === 'Director of Photography') {
      crew.push({ tmdb_id: String(member.id), name: member.name, role: 'cinematographer' })
    }
  }

  // Top 5 billed actors from cast list
  const topCast = (credits.cast ?? [])
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)

  for (const member of topCast) {
    crew.push({ tmdb_id: String(member.id), name: member.name, role: 'actor' })
  }

  return crew
}

// ─── TMDB response types (minimal) ───────────────────────────────────────────

interface TMDBCrewMember {
  id:   number
  name: string
  job:  string
}

interface TMDBCastMember {
  id:    number
  name:  string
  order: number
}

interface TMDBCreditsResponse {
  crew?: TMDBCrewMember[]
  cast?: TMDBCastMember[]
}
