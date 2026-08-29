import { describe, it, expect } from 'vitest'
import { dnaPromptContext } from '@/modules/dna/lib/prompt-context'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

/**
 * The chat model had no access to the fingerprint at all — a hardcoded prompt
 * and the message history, nothing else. So it agreed to "no anime" without
 * checking anything and had no way to honour it (2026-08-29).
 */

function dna(): DNASchema {
  return createBlankDNA('user-1')
}

describe('dnaPromptContext', () => {
  it('says nothing about a user it knows nothing about', () => {
    // A blank-fingerprint briefing invites the model to talk about defaults
    // as if they were the user's taste.
    expect(dnaPromptContext(dna())).toBe('')
  })

  it('states hard rules as binding, and names them', () => {
    const d = dna()
    d.contextual_logic.exclusion_rules.push({
      type: 'keyword', id: '', name: 'anime', raw: 'no anime', reason: 'never liked it',
    })
    const out = dnaPromptContext(d)
    expect(out).toContain('anime (never liked it)')
    expect(out).toMatch(/never to show/i)
    expect(out).toMatch(/never suggest anything matching a hard rule/i)
  })

  it('keeps soft preferences soft', () => {
    const d = dna()
    d.contextual_logic.soft_preferences.push({ signal: 'romance', weight_modifier: 0.3 })
    const out = dnaPromptContext(d)
    expect(out).toContain('Wants less of: romance')
    expect(out).toMatch(/not forbidden/i)
  })

  it('names trusted and distrusted crew, and ignores low-confidence noise', () => {
    const d = dna()
    d.strand_a_creative_affinity.directors = {
      '525': { name: 'Christopher Nolan', score: 0.8, confidence: 0.9, sample_size: 6, lineage_boost: 'none' },
      '111': { name: 'Michael Bay', score: -0.7, confidence: 0.8, sample_size: 4, lineage_boost: 'none' },
      '222': { name: 'One Rating Only', score: 0.9, confidence: 0.1, sample_size: 1, lineage_boost: 'none' },
    }
    const out = dnaPromptContext(d)
    expect(out).toContain('Christopher Nolan')
    expect(out).toContain('Michael Bay')
    expect(out).not.toContain('One Rating Only')
  })

  it('lists titles already judged so they stop being re-suggested', () => {
    const d = dna()
    d.signals.push({
      title: 'Tenet', tmdb_id: '577922', type: 'movie', reaction: 'disliked',
      quick_rating: null, regret_signal: null, source: 'session_1',
      reason: 'cold', dimensions_reinforced: [], dimensions_contradicted: [],
      confidence: 0.8, flag: null, watched_at: null,
    })
    const out = dnaPromptContext(d)
    expect(out).toContain('Tenet — disliked')
    expect(out).toMatch(/do not recommend these again/i)
  })
})
