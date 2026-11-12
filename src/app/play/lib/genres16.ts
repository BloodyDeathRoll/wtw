/**
 * The 16 genres people see and choose (the onboarding genre screen, signed off in #241; later the Taste DNA rule
 * picker). Option A of docs/plan/genres-16.md, done side by side: the 13 `GAME_GENRES` in ./genres.ts stay exactly
 * as they are for the taste model, the stored `game_genres` and the season, so no vector and no recommendation
 * moves. These 16 are what an answer *means*: "Never: Superheroes" hides superhero titles and nothing else.
 *
 * What splits, compared with the 13:
 *   - Sci-fi & fantasy → Sci-fi · Fantasy · Superheroes (superhero titles sit only under Superheroes);
 *   - Animation       → Adult animation · Kids' animation;
 *   - Family & kids   → live-action only (animated family films are Kids' animation).
 */
import { isAnime, type CatalogueGenreInput, type GameGenre } from './genres'

export const GENRES_16 = [
  { id: 'comedy',    label: 'Comedy' },
  { id: 'drama',     label: 'Drama' },
  { id: 'action',    label: 'Action' },
  { id: 'crime',     label: 'Crime' },
  { id: 'thriller',  label: 'Thriller & mystery' },
  { id: 'scifi',     label: 'Sci-fi' },
  { id: 'fantasy',   label: 'Fantasy' },
  { id: 'hero',      label: 'Superheroes' },
  { id: 'horror',    label: 'Horror' },
  { id: 'romance',   label: 'Romance' },
  { id: 'adultanim', label: 'Adult animation' },
  { id: 'anim',      label: 'Kids’ animation' },
  { id: 'family',    label: 'Family & kids' },
  { id: 'anime',     label: 'Anime' },
  { id: 'doc',       label: 'Documentary' },
  { id: 'war',       label: 'War & history' },
] as const

export type Genre16 = (typeof GENRES_16)[number]['id']
export const GENRE_16_IDS: readonly Genre16[] = GENRES_16.map(g => g.id)

/**
 * Where each of the 16 sits among the 13, for what reads the 13 (the season's picker, the taste model's genre
 * lean in P1-D4b). Lossy on purpose and only one way: the 16 are never derived from the 13.
 */
export const GENRE_13_OF: Record<Genre16, GameGenre> = {
  comedy: 'comedy', drama: 'drama', action: 'action', crime: 'crime', thriller: 'thriller',
  scifi: 'scifi', fantasy: 'scifi', hero: 'scifi', horror: 'horror', romance: 'romance',
  adultanim: 'anim', anim: 'anim', family: 'family', anime: 'anime', doc: 'doc', war: 'war',
}

/** TMDB genre (lowercased) → one of the 16, where the genre alone settles it. */
const PLAIN: Record<string, Genre16> = {
  'comedy': 'comedy', 'drama': 'drama', 'action': 'action', 'action & adventure': 'action', 'crime': 'crime',
  'thriller': 'thriller', 'mystery': 'thriller', 'science fiction': 'scifi', 'fantasy': 'fantasy',
  'horror': 'horror', 'romance': 'romance', 'documentary': 'doc',
  'war': 'war', 'history': 'war', 'war & politics': 'war',
}

export const SUPERHERO_KEYWORDS = ['superhero', 'superhero team', 'marvel cinematic universe (mcu)', 'dc extended universe (dceu)']   // not 'based on comic': it would catch The Walking Dead
export const ADULT_ANIMATION_KEYWORDS = ['adult animation']
/** TV has one "Sci-Fi & Fantasy" genre; its keywords tell the two apart. Neither found: it counts as both. */
const TV_FANTASY = ['fantasy', 'magic', 'dragon', 'wizard', 'sword and sorcery', 'fairy tale', 'mythology', 'witch', 'medieval', 'high fantasy', 'dark fantasy']
const TV_SCIFI = ['science fiction', 'space', 'alien', 'time travel', 'dystopia', 'robot', 'artificial intelligence', 'cyberpunk', 'post-apocalyptic future', 'spacecraft', 'future']

/** Which of the 16 a title is in, from its TMDB genres and keywords. */
export function genres16Of(row: CatalogueGenreInput): Genre16[] {
  const names = (row.genres ?? []).map(g => g.name.toLowerCase())
  const kw = new Set((row.keywords ?? []).map(k => k.toLowerCase()))
  const out = new Set<Genre16>()
  for (const n of names) { const g = PLAIN[n]; if (g) out.add(g) }

  if (names.includes('sci-fi & fantasy')) {
    const f = TV_FANTASY.some(k => kw.has(k)), s = TV_SCIFI.some(k => kw.has(k))
    if (f || !s) out.add('fantasy')
    if (s || !f) out.add('scifi')
  }
  if (SUPERHERO_KEYWORDS.some(k => kw.has(k))) { out.add('hero'); out.delete('scifi'); out.delete('fantasy') }

  const animated = names.includes('animation')
  if (isAnime(row)) out.add('anime')
  else if (animated) out.add(ADULT_ANIMATION_KEYWORDS.some(k => kw.has(k)) ? 'adultanim' : 'anim')
  if (!animated && (names.includes('family') || names.includes('kids'))) out.add('family')
  return GENRE_16_IDS.filter(g => out.has(g))
}
