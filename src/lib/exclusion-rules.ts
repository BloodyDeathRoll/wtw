/**
 * Exclusion + soft-preference matching — one definition, shared by the
 * candidate query (SQL params), the TypeScript post-filter, the scorer's
 * soft-preference penalty, and the read-time filter on a cached batch.
 *
 * Background (2026-08-29): a user said "no anime" in chat many times and the
 * next batch was 80% anime. Three separate reasons, all fixed together:
 *   1. Nothing in the chat path ever wrote a rule (analyze-session only
 *      extracted titles), so the assistant's "sure, no anime" was talk.
 *   2. Person rules carried `id: ''` while the filter matched on
 *      tmdb_person_id — so every "never show me X's films" was a no-op.
 *   3. There was nothing to match "anime" against. It is not a TMDB genre,
 *      and titles had neither original_language nor keywords (migration 0021).
 *
 * A rule hides exactly what it names (P1-C2, docs/plan/PLAN.md): rules now
 * come only from a "Never" or "Less of" + a genre picked from a list. A genre
 * rule matches that genre's TMDB genres and nothing else — no widening from a
 * word ("no musicals" used to hide Whiplash, "no rom-coms" all romance). A
 * keyword rule matches that TMDB keyword exactly, never a genre name. The one
 * category kept is anime (the keyword, or Animation + Japanese), because the
 * genre step offers it and TMDB has no anime genre.
 */

import type { ExclusionRule, ExclusionType, SoftPreference } from '@/types/dna'
import { GAME_GENRES, tmdbGenresOf } from '@/app/play/lib/genres'

// ─────────────────────────────────────────────
// The shape any matchable thing reduces to
// ─────────────────────────────────────────────

export interface MatchableTitle {
  genres?: { id?: number; name: string }[] | null
  keywords?: string[] | null
  original_language?: string | null
  tone_tags?: string[] | null
  crew?: {
    directors?: { tmdb_person_id: string; name: string }[]
    writers?: { tmdb_person_id: string; name: string }[]
    cinematographers?: { tmdb_person_id: string; name: string }[]
    cast?: { tmdb_person_id: string; name: string }[]
  } | null
}

/** What a free-text rule name widens into. */
export interface RuleTargets {
  genres: string[]      // lowercased genre names
  keywords: string[]    // lowercased TMDB keywords / tone tags
  languages: string[]   // ISO 639-1
  /**
   * All-of conditions that no single column expresses. Checked in TypeScript
   * only — SQL gets the OR-able parts above, which are deliberately the
   * *narrow* ones, so the SQL pass never over-excludes on their behalf.
   */
  conjunctions: { genres?: string[]; languages?: string[] }[]
}

const EMPTY: RuleTargets = { genres: [], keywords: [], languages: [], conjunctions: [] }

/**
 * Anime: TMDB tags most of it with the keyword "anime", but coverage is not
 * total, so the conjunction (Animation + Japanese) backstops it. Excluding
 * language `ja` alone would take Kurosawa with it, which is why it is never
 * an OR term on its own.
 */
const ANIME: RuleTargets = {
  genres: [],
  keywords: ['anime'],
  languages: [],
  conjunctions: [{ genres: ['animation'], languages: ['ja'] }],
}

/** TMDB genre names, movie and TV, lowercased. */
const TMDB_GENRES = new Set([
  'action', 'adventure', 'animation', 'comedy', 'crime', 'documentary', 'drama',
  'family', 'fantasy', 'history', 'horror', 'music', 'mystery', 'romance',
  'science fiction', 'thriller', 'war', 'western', 'kids', 'news', 'reality',
  'soap', 'talk', 'action & adventure', 'sci-fi & fantasy', 'war & politics',
])

/** A game genre by id ("scifi") or label ("Sci-fi & fantasy"). */
const GAME_GENRE_BY_NAME = new Map(GAME_GENRES.flatMap(g => [[g.id, g.id], [g.label.toLowerCase(), g.id]] as const))

/** The TMDB genres a genre rule hides: its game genre's set, or the one TMDB genre it names; [] when it names neither. */
function genreSet(name: string): string[] {
  const game = GAME_GENRE_BY_NAME.get(name)
  if (game) return tmdbGenresOf(game)
  const tmdb = canonicalGenre(name)
  return TMDB_GENRES.has(tmdb) ? [tmdb] : []
}

/**
 * What kind of thing a rule name is, for a rule the user typed rather than
 * picked. Only the two answers that can be told apart without guessing: a
 * genre (a game genre, anime included, or a TMDB genre), or a keyword.
 *
 * `person` is deliberately never inferred. A name needs a TMDB lookup to be
 * matchable, and a wrong guess produces a rule that matches nothing while
 * looking like it works — the exact silent failure this file exists to end.
 */
export function classifyRuleTarget(name: string): ExclusionType {
  return genreSet(norm(name)).length > 0 || norm(name) === 'anime' ? 'genre' : 'keyword'
}

/**
 * Other spellings of a TMDB genre's own name — never a narrower thing mapped
 * onto a broader genre (rom-com → romance, musical → music, cartoon →
 * animation are gone: they hid far more than was named).
 */
const GENRE_SPELLINGS: Record<string, string> = {
  'sci-fi': 'science fiction', 'sci fi': 'science fiction', 'science-fiction': 'science fiction',
  docs: 'documentary', doco: 'documentary',
}

/** The TMDB genre a typed name means, or the name unchanged. */
export function canonicalGenre(name: string): string {
  const n = norm(name)
  if (TMDB_GENRES.has(n)) return n
  if (GENRE_SPELLINGS[n]) return GENRE_SPELLINGS[n]
  // Plurals: westerns → western, comedies → comedy, romances → romance.
  for (const form of [n.replace(/ies$/, 'y'), n.replace(/es$/, ''), n.replace(/s$/, '')]) {
    if (TMDB_GENRES.has(form)) return form
    if (GENRE_SPELLINGS[form]) return GENRE_SPELLINGS[form]
  }
  return n
}

/** Is this a category word beyond plain genres and keywords? Only anime now. */
export function isKnownCategory(name: string): boolean {
  return norm(name) === 'anime'
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * What one rule hides: a genre rule, its genre's TMDB genres; a keyword rule,
 * that TMDB keyword; anime, by keyword or Animation + Japanese. Person rules
 * return nothing here — they are matched on crew, not content.
 */
export function ruleTargets(rule: { type: string; name: string }): RuleTargets {
  if (rule.type === 'person') return EMPTY
  const name = norm(rule.name)
  if (!name) return EMPTY
  if (name === 'anime') return ANIME
  if (rule.type === 'genre') {
    const genres = genreSet(name)
    return genres.length ? { genres, keywords: [], languages: [], conjunctions: [] } : EMPTY
  }
  return { genres: [], keywords: [name], languages: [], conjunctions: [] }
}

/** Union of every rule's OR-able targets — the three SQL array params. */
export function sqlExclusionParams(rules: { type: string; name: string }[]): {
  exclude_genres: string[]
  exclude_keywords: string[]
  exclude_languages: string[]
} {
  const g = new Set<string>(), k = new Set<string>(), l = new Set<string>()
  for (const r of rules) {
    const t = ruleTargets(r)
    t.genres.forEach(x => g.add(x))
    t.keywords.forEach(x => k.add(x))
    t.languages.forEach(x => l.add(x))
  }
  return { exclude_genres: [...g], exclude_keywords: [...k], exclude_languages: [...l] }
}

// ─────────────────────────────────────────────
// TypeScript matching
// ─────────────────────────────────────────────

function titleGenres(t: MatchableTitle): string[] {
  return (t.genres ?? []).map(g => norm(g.name))
}

/** Does this person rule name anyone in the title's crew? */
function matchesPerson(t: MatchableTitle, rule: ExclusionRule): boolean {
  const c = t.crew
  if (!c) return false
  const all = [
    ...(c.directors ?? []),
    ...(c.writers ?? []),
    ...(c.cinematographers ?? []),
    ...(c.cast ?? []),
  ]
  if (all.length === 0) return false
  // id first — set by searchPerson() when the rule was written. The name
  // fallback is what keeps a rule working when TMDB person search missed,
  // which is exactly how every person rule used to fail silently.
  if (rule.id && all.some(p => p.tmdb_person_id === rule.id)) return true
  const name = norm(rule.name)
  return name.length > 2 && all.some(p => norm(p.name) === name)
}

/** Does this title match this one rule? */
export function matchesRule(title: MatchableTitle, rule: ExclusionRule): boolean {
  if (rule.type === 'person') return matchesPerson(title, rule)

  const t = ruleTargets(rule)
  const genres = titleGenres(title)
  const keywords = (title.keywords ?? []).map(norm)
  const lang = norm(title.original_language ?? '')

  if (t.genres.some(x => genres.includes(x))) return true
  if (t.keywords.some(x => keywords.includes(x))) return true
  if (t.languages.length > 0 && lang && t.languages.includes(lang)) return true

  for (const c of t.conjunctions) {
    const genreOk = !c.genres || c.genres.every(x => genres.includes(x))
    const langOk = !c.languages || (!!lang && c.languages.includes(lang))
    if (genreOk && langOk) return true
  }
  return false
}

/** True when ANY of the user's hard rules excludes this title. */
export function isExcluded(title: MatchableTitle, rules: ExclusionRule[]): boolean {
  return rules.some(r => matchesRule(title, r))
}

// ─────────────────────────────────────────────
// Soft preferences
// ─────────────────────────────────────────────

/**
 * A soft preference ("Less of: romance") is the same statement as a rule,
 * said less absolutely — step3-soft-modifiers.ts applies it as a score
 * multiplier rather than a cut — and it matches exactly like one (P1-C2): a
 * genre its TMDB genres, a keyword that keyword, a person their crew credits.
 * `pref.target_type` says which; without it the signal is classified the way
 * a typed rule is.
 */
export function matchesSoftSignal(
  title: MatchableTitle,
  signal: string,
  pref?: Pick<SoftPreference, 'target_type' | 'person_id'>,
): boolean {
  if (!norm(signal)) return false
  if (pref?.target_type === 'person') {
    return matchesPerson(title, {
      type: 'person', id: pref.person_id ?? '', name: signal, raw: signal, reason: '',
    })
  }
  const type = pref?.target_type ?? classifyRuleTarget(signal)
  return matchesRule(title, { type, id: '', name: signal, raw: signal, reason: '' })
}

/**
 * Product of every matching preference's modifier. Two matching prefs
 * compound, which is what stacking them means.
 */
export function softPreferenceMultiplier(
  title: MatchableTitle,
  prefs: SoftPreference[],
): number {
  let m = 1
  for (const p of prefs) {
    const weight = Number.isFinite(p.weight_modifier) ? p.weight_modifier : 1
    if (weight >= 1) continue
    if (matchesSoftSignal(title, p.signal, p)) m *= Math.max(0, weight)
  }
  return m
}

/**
 * Stable identity for a rule, for dedup on write and for the remove button on
 * the Taste DNA page. Type + name is the identity — the same person named
 * twice in two sessions is one rule.
 */
export function ruleKey(rule: { type: string; name: string }): string {
  return `${rule.type}:${norm(rule.name)}`
}
