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
 * A rule's `name` is free text the user said. Matching it means widening it
 * into the three things the catalog can actually be filtered on — genre
 * names, TMDB keywords, ISO language codes — plus, for the cases where no
 * single field is enough, a conjunction checked in TypeScript.
 */

import type { ExclusionRule, SoftPreference } from '@/types/dna'

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
 * Category aliases — the handful of things people name that the catalog does
 * not store under that name. Anime is the motivating case: TMDB tags most of
 * it with the keyword "anime", but coverage is not total, so the conjunction
 * (Animation + Japanese) backstops it. Excluding language `ja` alone would
 * take Kurosawa with it, which is why it is never an OR term on its own.
 */
const ALIASES: Record<string, RuleTargets> = {
  anime: {
    genres: [],
    keywords: ['anime'],
    languages: [],
    conjunctions: [{ genres: ['animation'], languages: ['ja'] }],
  },
  manga: {
    genres: [],
    keywords: ['anime', 'based on manga'],
    languages: [],
    conjunctions: [{ genres: ['animation'], languages: ['ja'] }],
  },
  bollywood: { genres: [], keywords: ['bollywood'], languages: ['hi'], conjunctions: [] },
  'k-drama': { genres: [], keywords: ['k-drama'], languages: [], conjunctions: [{ genres: ['drama'], languages: ['ko'] }] },
  kdrama:    { genres: [], keywords: ['k-drama'], languages: [], conjunctions: [{ genres: ['drama'], languages: ['ko'] }] },
  'korean drama': { genres: [], keywords: ['k-drama'], languages: [], conjunctions: [{ genres: ['drama'], languages: ['ko'] }] },
  telenovela: { genres: [], keywords: ['telenovela'], languages: [], conjunctions: [] },
  'reality tv': { genres: ['reality'], keywords: ['reality tv', 'reality show'], languages: [], conjunctions: [] },
  cartoons: { genres: ['animation'], keywords: [], languages: [], conjunctions: [] },
  cartoon:  { genres: ['animation'], keywords: [], languages: [], conjunctions: [] },
  subtitles: { genres: [], keywords: [], languages: [], conjunctions: [] }, // "no subtitles" is not an exclusion we can honour
}

/**
 * Language names people actually say, mapped to what TMDB stores. Only used
 * when a rule reads as a language/nationality rule ("no French films"), never
 * inferred from a bare genre word.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  japanese: 'ja', french: 'fr', korean: 'ko', spanish: 'es', german: 'de',
  italian: 'it', hindi: 'hi', mandarin: 'zh', chinese: 'zh', cantonese: 'cn',
  russian: 'ru', portuguese: 'pt', swedish: 'sv', danish: 'da', norwegian: 'no',
  turkish: 'tr', arabic: 'ar', hebrew: 'he', thai: 'th', polish: 'pl',
  dutch: 'nl', finnish: 'fi', english: 'en',
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Widen one rule's free-text name into catalog-matchable targets.
 * Person rules return nothing here — they are matched on crew, not content.
 */
export function ruleTargets(rule: { type: string; name: string }): RuleTargets {
  if (rule.type === 'person') return EMPTY
  const name = norm(rule.name)
  if (!name) return EMPTY

  const alias = ALIASES[name]
  if (alias) return alias

  // "french" / "french films" / "french cinema" → language rule
  const bare = name.replace(/\b(films?|movies?|cinema|shows?|series|tv)\b/g, '').trim()
  const lang = LANGUAGE_NAMES[bare]
  if (lang) return { genres: [], keywords: [], languages: [lang], conjunctions: [] }

  // Everything else matches by the literal word, as a genre name and as a
  // keyword. One of the two hits; a name that is neither simply matches
  // nothing, which is the honest outcome for an unrecognisable rule.
  return { genres: [bare || name], keywords: [bare || name], languages: [], conjunctions: [] }
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

function titleTerms(t: MatchableTitle): string[] {
  return [
    ...titleGenres(t),
    ...(t.keywords ?? []).map(norm),
    ...(t.tone_tags ?? []).map(norm),
  ]
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
  const terms = titleTerms(title)
  const lang = norm(title.original_language ?? '')

  if (t.genres.some(x => genres.includes(x))) return true
  if (t.keywords.some(x => terms.includes(x))) return true
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
 * A soft preference ("less romance") is the same kind of statement as a hard
 * rule, said less absolutely — step3-soft-modifiers.ts applies it as a score
 * multiplier rather than a cut. It used to match on a loose substring test
 * over genre names and tone tags only, which is why a preference phrased in
 * catalog terms the title didn't literally carry never fired.
 *
 * This widens it the same way a keyword rule is widened (aliases, TMDB
 * keywords, language), and keeps the old substring test as a fallback so no
 * preference that used to match stops matching.
 */
export function matchesSoftSignal(title: MatchableTitle, signal: string): boolean {
  const s = norm(signal)
  if (!s) return false

  const asRule: ExclusionRule = { type: 'keyword', id: '', name: signal, raw: signal, reason: '' }
  if (matchesRule(title, asRule)) return true

  // Legacy substring behaviour, both directions ("noir" vs "neo-noir").
  const terms = titleTerms(title)
  return terms.some(term => term.includes(s) || s.includes(term))
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
    if (matchesSoftSignal(title, p.signal)) m *= Math.max(0, weight)
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
