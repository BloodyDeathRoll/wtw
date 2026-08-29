import { describe, it, expect } from 'vitest'
import {
  matchesRule,
  isExcluded,
  ruleTargets,
  sqlExclusionParams,
  matchesSoftSignal,
  softPreferenceMultiplier,
  ruleKey,
  type MatchableTitle,
} from '@/lib/exclusion-rules'
import { applyDirectives } from '@/modules/dna/lib/apply-directives'
import { hasMaterialChange } from '@/modules/session/session-change'
import type { ContextualLogic, ExclusionRule, SessionSummary } from '@/types/dna'

/**
 * The reported bug (2026-08-29): the user said "no anime" repeatedly, the chat
 * model agreed every time, and the next batch was ~80% anime. Three causes,
 * each of which gets a test here:
 *   1. Nothing wrote a rule from conversation at all.
 *   2. Person rules carried an empty id but were matched on tmdb_person_id.
 *   3. "anime" had nothing to match against — not a genre, and titles had no
 *      original_language or keywords.
 */

const rule = (over: Partial<ExclusionRule>): ExclusionRule => ({
  type: 'keyword', id: '', name: '', raw: '', reason: '', ...over,
})

const title = (over: Partial<MatchableTitle>): MatchableTitle => ({
  genres: [], keywords: [], original_language: 'en', tone_tags: [], crew: null, ...over,
})

const NARUTO = title({
  genres: [{ name: 'Animation' }, { name: 'Action' }],
  keywords: ['anime', 'ninja'],
  original_language: 'ja',
})
const SPIRITED_AWAY_NO_KEYWORD = title({
  genres: [{ name: 'Animation' }, { name: 'Fantasy' }],
  keywords: [],                 // TMDB keyword coverage is not total
  original_language: 'ja',
})
const TOY_STORY = title({
  genres: [{ name: 'Animation' }, { name: 'Family' }],
  keywords: ['toy'],
  original_language: 'en',
})
const RASHOMON = title({
  genres: [{ name: 'Drama' }, { name: 'Crime' }],
  keywords: [],
  original_language: 'ja',
})

describe('"no anime"', () => {
  const anime = rule({ type: 'keyword', name: 'anime' })

  it('excludes an anime title by TMDB keyword', () => {
    expect(matchesRule(NARUTO, anime)).toBe(true)
  })

  it('still excludes it when TMDB has no anime keyword — Animation + Japanese', () => {
    expect(matchesRule(SPIRITED_AWAY_NO_KEYWORD, anime)).toBe(true)
  })

  it('does not take Western animation with it', () => {
    expect(matchesRule(TOY_STORY, anime)).toBe(false)
  })

  it('does not take live-action Japanese cinema with it', () => {
    // The reason `ja` is never an OR term on its own: excluding anime must not
    // silently exclude Kurosawa.
    expect(matchesRule(RASHOMON, anime)).toBe(false)
  })

  it('sends the narrow parts to SQL and keeps the conjunction in TypeScript', () => {
    const params = sqlExclusionParams([anime])
    expect(params.exclude_keywords).toContain('anime')
    expect(params.exclude_languages).toEqual([])   // never blanket-block Japanese
    expect(ruleTargets(anime).conjunctions).toEqual([
      { genres: ['animation'], languages: ['ja'] },
    ])
  })
})

describe('person rules', () => {
  const withRuffalo = title({
    crew: { directors: [], writers: [], cinematographers: [], cast: [{ tmdb_person_id: '103', name: 'Mark Ruffalo' }] },
  })

  it('matches on the resolved TMDB person id', () => {
    expect(matchesRule(withRuffalo, rule({ type: 'person', id: '103', name: 'Mark Ruffalo' }))).toBe(true)
  })

  it('still matches by name when the id was never resolved', () => {
    // Every person rule used to be written with id: '' and matched on id only,
    // so "never show me X's films" was a guaranteed no-op.
    expect(matchesRule(withRuffalo, rule({ type: 'person', id: '', name: 'Mark Ruffalo' }))).toBe(true)
  })

  it('checks every crew role, not just cast', () => {
    const directed = title({
      crew: { directors: [{ tmdb_person_id: '525', name: 'Christopher Nolan' }], writers: [], cinematographers: [], cast: [] },
    })
    expect(matchesRule(directed, rule({ type: 'person', id: '525', name: 'Christopher Nolan' }))).toBe(true)
  })

  it('does not match an unrelated title', () => {
    expect(matchesRule(TOY_STORY, rule({ type: 'person', id: '103', name: 'Mark Ruffalo' }))).toBe(false)
  })
})

describe('other rule shapes', () => {
  it('matches a real genre by name', () => {
    expect(matchesRule(TOY_STORY, rule({ type: 'genre', name: 'Family' }))).toBe(true)
  })

  it('reads a language rule out of "no French films"', () => {
    const french = title({ original_language: 'fr', genres: [{ name: 'Drama' }] })
    expect(matchesRule(french, rule({ type: 'keyword', name: 'French films' }))).toBe(true)
    expect(matchesRule(TOY_STORY, rule({ type: 'keyword', name: 'French films' }))).toBe(false)
  })

  it('matches a franchise on its TMDB keyword', () => {
    const marvel = title({ keywords: ['marvel cinematic universe', 'superhero'] })
    expect(matchesRule(marvel, rule({ type: 'franchise', name: 'marvel cinematic universe' }))).toBe(true)
  })

  it('a rule that matches nothing excludes nothing', () => {
    expect(isExcluded(TOY_STORY, [rule({ name: 'zzzz nonsense' })])).toBe(false)
  })

  it('isExcluded is any-of', () => {
    expect(isExcluded(TOY_STORY, [rule({ name: 'anime' }), rule({ type: 'genre', name: 'Family' })])).toBe(true)
  })
})

describe('soft preferences', () => {
  it('matches through the same widening as a rule', () => {
    expect(matchesSoftSignal(NARUTO, 'anime')).toBe(true)
  })

  it('keeps the old substring behaviour', () => {
    const noir = title({ tone_tags: ['neo-noir'] })
    expect(matchesSoftSignal(noir, 'noir')).toBe(true)
  })

  it('honours a person named softly — "less Adam Sandler"', () => {
    // Without target_type the name is compared against genres and keywords,
    // where a person's name never appears, so the preference did nothing.
    const sandler = title({
      genres: [{ name: 'Comedy' }],
      crew: { directors: [], writers: [], cinematographers: [], cast: [{ tmdb_person_id: '19292', name: 'Adam Sandler' }] },
    })
    expect(matchesSoftSignal(sandler, 'Adam Sandler')).toBe(false)
    expect(matchesSoftSignal(sandler, 'Adam Sandler', { target_type: 'person', person_id: '19292' })).toBe(true)
    // And by name, when TMDB person search missed.
    expect(matchesSoftSignal(sandler, 'Adam Sandler', { target_type: 'person', person_id: '' })).toBe(true)
    expect(matchesSoftSignal(TOY_STORY, 'Adam Sandler', { target_type: 'person', person_id: '19292' })).toBe(false)

    expect(softPreferenceMultiplier(sandler, [
      { signal: 'Adam Sandler', weight_modifier: 0.3, target_type: 'person', person_id: '19292' },
    ])).toBe(0.3)
  })

  it('compounds matching modifiers and leaves non-matches alone', () => {
    expect(softPreferenceMultiplier(NARUTO, [{ signal: 'anime', weight_modifier: 0.5 }])).toBe(0.5)
    expect(softPreferenceMultiplier(TOY_STORY, [{ signal: 'anime', weight_modifier: 0.5 }])).toBe(1)
    expect(
      softPreferenceMultiplier(NARUTO, [
        { signal: 'anime', weight_modifier: 0.5 },
        { signal: 'action', weight_modifier: 0.5 },
      ]),
    ).toBe(0.25)
  })
})

describe('applyDirectives', () => {
  const logic = (): ContextualLogic => ({
    exclusion_rules: [], soft_preferences: [], temporal_modifiers: [],
  })

  it('turns a chat instruction into a stored rule', () => {
    const l = logic()
    const res = applyDirectives(l, [
      { kind: 'exclusion', target_type: 'keyword', name: 'anime', raw: 'no anime please', reason: 'not for me' },
    ])
    expect(res.exclusions_added).toBe(1)
    expect(l.exclusion_rules[0].name).toBe('anime')
  })

  it('does not stack a rule the user repeats every session', () => {
    const l = logic()
    const d = { kind: 'exclusion' as const, target_type: 'keyword' as const, name: 'Anime', raw: 'no anime', reason: '' }
    applyDirectives(l, [d])
    applyDirectives(l, [{ ...d, name: 'anime' }])
    expect(l.exclusion_rules).toHaveLength(1)
  })

  it('fills in a person id learned on a later mention', () => {
    const l = logic()
    applyDirectives(l, [{ kind: 'exclusion', target_type: 'person', name: 'Mark Ruffalo', raw: '', reason: '', person_id: '' }])
    applyDirectives(l, [{ kind: 'exclusion', target_type: 'person', name: 'Mark Ruffalo', raw: '', reason: '', person_id: '103' }])
    expect(l.exclusion_rules).toHaveLength(1)
    expect(l.exclusion_rules[0].id).toBe('103')
  })

  it('escalates a soft preference to a hard rule, never the reverse', () => {
    const l = logic()
    applyDirectives(l, [{ kind: 'soft_preference', target_type: 'genre', name: 'romance', raw: '', reason: '', weight_modifier: 0.5 }])
    applyDirectives(l, [{ kind: 'exclusion', target_type: 'genre', name: 'romance', raw: '', reason: '' }])
    expect(l.soft_preferences).toHaveLength(0)
    expect(l.exclusion_rules).toHaveLength(1)

    applyDirectives(l, [{ kind: 'soft_preference', target_type: 'genre', name: 'romance', raw: '', reason: '', weight_modifier: 0.8 }])
    expect(l.soft_preferences).toHaveLength(0)
  })

  it('keeps a person preference matchable', () => {
    const l = logic()
    applyDirectives(l, [{
      kind: 'soft_preference', target_type: 'person', name: 'Adam Sandler',
      raw: '', reason: '', weight_modifier: 0.3, person_id: '19292',
    }])
    expect(l.soft_preferences[0].target_type).toBe('person')
    expect(l.soft_preferences[0].person_id).toBe('19292')
  })

  it('backfills a person id onto a preference restated later', () => {
    const l = logic()
    const base = { kind: 'soft_preference' as const, target_type: 'person' as const, name: 'Adam Sandler', raw: '', reason: '' }
    applyDirectives(l, [{ ...base, weight_modifier: 0.5, person_id: '' }])
    applyDirectives(l, [{ ...base, weight_modifier: 0.5, person_id: '19292' }])
    expect(l.soft_preferences).toHaveLength(1)
    expect(l.soft_preferences[0].person_id).toBe('19292')
  })

  it('keeps the stronger reduction when a preference is restated', () => {
    const l = logic()
    applyDirectives(l, [{ kind: 'soft_preference', target_type: 'genre', name: 'romance', raw: '', reason: '', weight_modifier: 0.8 }])
    applyDirectives(l, [{ kind: 'soft_preference', target_type: 'genre', name: 'romance', raw: '', reason: '', weight_modifier: 0.3 }])
    expect(l.soft_preferences[0].weight_modifier).toBe(0.3)
  })
})

describe('a rules-only session is a material change', () => {
  const empty: SessionSummary = {
    session_number: 3, new_signals: [], dimension_updates: {},
    open_questions_resolved: [], new_open_questions: [],
    recommendation_made: null, recommendation_accepted: null,
  }

  it('was previously fast-pathed, keeping the very batch the rule was meant to replace', () => {
    expect(hasMaterialChange(empty)).toBe(false)
    expect(hasMaterialChange({
      ...empty,
      directives: [{ kind: 'exclusion', target_type: 'keyword', name: 'anime', raw: '', reason: '' }],
    })).toBe(true)
  })
})

describe('ruleKey', () => {
  it('is type + name, case- and space-insensitive', () => {
    expect(ruleKey({ type: 'person', name: '  Mark Ruffalo ' })).toBe('person:mark ruffalo')
    expect(ruleKey({ type: 'keyword', name: 'Anime' })).toBe(ruleKey({ type: 'keyword', name: 'anime' }))
  })
})
