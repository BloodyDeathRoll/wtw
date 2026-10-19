/**
 * The 12 genres of the taste games, and how a catalogue row maps onto them.
 *
 * TMDB uses different genre lists for movies and series: series have no
 * Horror, Romance, Thriller or War genre ("Mystery", "War & Politics" and
 * "Sci-Fi & Fantasy" stand in), so for those a series is matched on its
 * keywords instead. Anime is not a TMDB genre at all — it is the same
 * Animation + Japanese conjunction (or the `anime` keyword) that
 * `src/lib/exclusion-rules.ts` uses, and an anime title is never also tagged
 * "Animation" here, so "Never: Anime" and "Love: Animation" don't collide.
 */

export const GAME_GENRES = [
  { id: 'comedy',   label: 'Comedy' },
  { id: 'drama',    label: 'Drama' },
  { id: 'action',   label: 'Action' },
  { id: 'crime',    label: 'Crime' },
  { id: 'thriller', label: 'Thriller & mystery' },
  { id: 'scifi',    label: 'Sci-fi & fantasy' },
  { id: 'horror',   label: 'Horror' },
  { id: 'romance',  label: 'Romance' },
  { id: 'anim',     label: 'Animation' },
  { id: 'anime',    label: 'Anime' },
  { id: 'doc',      label: 'Documentary' },
  { id: 'war',      label: 'War & history' },
] as const

export type GameGenre = (typeof GAME_GENRES)[number]['id']

export const GAME_GENRE_IDS: readonly GameGenre[] = GAME_GENRES.map(g => g.id)

/** TMDB genre name (lowercased) → game genre, for each media type. */
const BY_TMDB_GENRE: Record<'movie' | 'tv', Record<string, GameGenre>> = {
  movie: {
    'comedy': 'comedy',
    'drama': 'drama',
    'action': 'action',
    'crime': 'crime',
    'thriller': 'thriller',
    'mystery': 'thriller',
    'science fiction': 'scifi',
    'fantasy': 'scifi',
    'horror': 'horror',
    'romance': 'romance',
    'animation': 'anim',
    'documentary': 'doc',
    'war': 'war',
    'history': 'war',
  },
  tv: {
    'comedy': 'comedy',
    'drama': 'drama',
    'action & adventure': 'action',
    'crime': 'crime',
    'mystery': 'thriller',
    'sci-fi & fantasy': 'scifi',
    'animation': 'anim',
    'documentary': 'doc',
    'war & politics': 'war',
  },
}

/**
 * Movies only: "Adventure" is on Toy Story and Harry Potter as much as on
 * Mad Max, so it only hints at Action and the model confirms.
 */
const MOVIE_GENRE_HINTS: Record<string, GameGenre> = { 'adventure': 'action' }

/**
 * Series only: genres TMDB cannot express for TV, matched on keywords.
 * These are hints, not verdicts — keyword tagging is loose ("romance" is on
 * Better Call Saul), so the build script asks the model to confirm each one
 * and keeps a keyword-only genre only when it agrees.
 */
const TV_KEYWORD_HINTS: { genre: GameGenre; keywords: string[] }[] = [
  { genre: 'horror',   keywords: ['horror', 'supernatural horror', 'zombie', 'slasher'] },
  { genre: 'romance',  keywords: ['romance', 'love triangle', 'romantic comedy'] },
  { genre: 'thriller', keywords: ['thriller', 'psychological thriller'] },
  { genre: 'war',      keywords: ['war', 'world war ii', 'historical', 'history'] },
]

/**
 * Series only: wider nets used ONLY to block a "Never" genre. Measured
 * 2026-10-14: the model confirmed "horror" for Adventure Time off a "vampire"
 * keyword, so these words are too loose to tag a genre a player loves — but a
 * horror hater shouldn't meet a vampire series either. Movies don't need this:
 * TMDB gives movies a real Horror genre. Kept narrow on purpose — "monster",
 * "demon" or "serial killer" would block Monsters, Inc. and The Mentalist.
 */
const TV_NEVER_KEYWORDS: { genre: GameGenre; keywords: string[] }[] = [
  { genre: 'horror',  keywords: ['vampire', 'ghost', 'werewolf', 'haunted house'] },
  { genre: 'romance', keywords: ['love'] },
]

export interface CatalogueGenreInput {
  type: 'movie' | 'tv'
  genres: { name: string }[] | null
  keywords: string[] | null
  original_language: string | null
}

export function isAnime(row: CatalogueGenreInput): boolean {
  const names = (row.genres ?? []).map(g => g.name.toLowerCase())
  const keywords = row.keywords ?? []
  return keywords.includes('anime') || (names.includes('animation') && row.original_language === 'ja')
}

/**
 * Game genres a row belongs to, split by how sure we are: `firm` comes from
 * TMDB's own genres (or the anime rule), `hinted` from a keyword or a
 * loose genre (movie Adventure) and needs the model's confirmation.
 */
export function candidateGenres(row: CatalogueGenreInput): { firm: GameGenre[]; hinted: GameGenre[] } {
  const firm = new Set<GameGenre>()
  for (const g of row.genres ?? []) {
    const mapped = BY_TMDB_GENRE[row.type][g.name.toLowerCase()]
    if (mapped) firm.add(mapped)
  }
  if (isAnime(row)) {
    firm.delete('anim')
    firm.add('anime')
  }

  const hinted = new Set<GameGenre>()
  if (row.type === 'movie') {
    for (const g of row.genres ?? []) {
      const hint = MOVIE_GENRE_HINTS[g.name.toLowerCase()]
      if (hint && !firm.has(hint)) hinted.add(hint)
    }
  } else {
    const keywords = new Set(row.keywords ?? [])
    for (const hint of TV_KEYWORD_HINTS) {
      if (!firm.has(hint.genre) && hint.keywords.some(k => keywords.has(k))) hinted.add(hint.genre)
    }
  }
  return { firm: [...firm], hinted: [...hinted] }
}

/**
 * Genres a title might belong to, for the "Never" filter only: its own genres,
 * plus — for series — every unconfirmed hint and the wider keyword nets above.
 */
export function neverGenres(row: CatalogueGenreInput, confirmed: GameGenre[]): GameGenre[] {
  const { firm, hinted } = candidateGenres(row)
  const out = new Set<GameGenre>([...firm, ...confirmed])
  // Movies carry real TMDB genres; their only hint ("Adventure" → action)
  // would block Toy Story for an action hater. Series hints stand in for
  // genres TMDB lacks, so an unconfirmed one still blocks.
  if (row.type === 'tv') {
    for (const g of hinted) out.add(g)
    const keywords = new Set(row.keywords ?? [])
    for (const n of TV_NEVER_KEYWORDS) if (n.keywords.some(k => keywords.has(k))) out.add(n.genre)
  }
  return [...out]
}
