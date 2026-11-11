import { describe, it, expect } from 'vitest'

import { createBlankDNA } from '@/modules/dna/blank-dna'
import { stripChat, type PlayReapply } from '@/modules/dna/lib/strip-chat'
import type { DNASchema, DNASignal } from '@/types/dna'

// scripts/strip-chat-from-dna.mts's logic (P1-C1): everything chat-made goes,
// the games' own rules come back, the version moves.

const sig = (tmdb_id: string, source: DNASignal['source']): DNASignal => ({
  title: tmdb_id, tmdb_id, type: 'movie', reaction: 'liked', quick_rating: null, regret_signal: null, source, reason: '',
  dimensions_reinforced: [], dimensions_contradicted: [], confidence: 1, flag: null, watched_at: null,
})

function chatty(): DNASchema {
  const dna = createBlankDNA('u1')
  dna.signals = [sig('1', 'onboarding'), sig('2', 'session_3'), sig('1', 'manual'), sig('3', 'recommendation_accepted')]
  dna.contextual_logic.exclusion_rules = [
    { type: 'genre', id: 'r1', name: 'dramas', raw: 'never dramas', reason: 'said in chat' },
    { type: 'genre', id: 'play:never:horror', name: 'horror', raw: 'Never: horror', reason: 'Marked "Never" in the taste games' },
  ]
  dna.contextual_logic.soft_preferences = [{ signal: 'romance', weight_modifier: 0.5 }]
  dna.contextual_logic.temporal_modifiers = [{ condition: 'evening_tired', boost: 'comedy', suppress: 'drama' }]
  dna.metadata.play_sync = {
    v: 1, sel: ['comedy'], block: 1, round: 3, done: false, skipped: false,
    genres: {}, languages: {}, rules: ['play:never:horror'], pacing: {}, tone: {}, strandB: {}, crew: {},
  }
  return dna
}

const noTitles = new Map()

describe('stripChat', () => {
  it('removes chat signals, rules, preferences and moods; reports all but the games\' rules', () => {
    const dna = chatty()
    const v = dna.metadata.taste_version
    const r = stripChat(dna, noTitles, null)
    expect(r.rules).toEqual(['dramas'])
    expect(r.softPreferences).toEqual(['romance'])
    expect(r.temporalModifiers).toEqual(['evening_tired'])
    expect(r.chatSignals).toEqual(['movie:2'])
    expect(dna.signals.map(s => `${s.tmdb_id}/${s.source}`)).toEqual(['1/onboarding', '3/recommendation_accepted'])
    expect(dna.contextual_logic).toEqual({ exclusion_rules: [], soft_preferences: [], temporal_modifiers: [] })
    expect(dna.metadata.play_sync).toBeUndefined()
    expect(dna.metadata.taste_version).toBe(v + 1)
  })

  it('puts the games\' "Never" rules back from the play state', () => {
    const dna = chatty()
    const play: PlayReapply = {
      inf: { genres: {}, languages: {}, never: ['horror'], pacing: {}, tone: {}, strandB: {}, creators: [] },
      creators: [],
      state: { sel: ['comedy'], block: 1, round: 3, skipped: false, done: false },
    }
    stripChat(dna, noTitles, play)
    expect(dna.contextual_logic.exclusion_rules.map(r => r.id)).toContain('play:never:horror')
    expect(dna.contextual_logic.exclusion_rules.every(r => r.id.startsWith('play:'))).toBe(true)
    expect((dna.metadata.play_sync as { rules: string[] }).rules).toContain('play:never:horror')
  })
})
