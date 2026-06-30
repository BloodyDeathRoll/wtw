/**
 * Step 3 — Soft Preference Modifiers
 *
 * Applies contextual_logic.soft_preferences as score multipliers.
 * A weight_modifier of 0.7 means "reduce score by 30% for titles matching this signal."
 * These are not eliminations — they adjust ranking only.
 *
 * Also applies temporal_modifiers when session_override_active is true
 * (e.g. user said "something light tonight" → suppress slow-burn candidates).
 *
 * Re-sorts by composite_score after modification.
 */

import type { DNASchema, SessionContext } from '@/types/dna'
import type { ScoredTitle } from '../types'

export function applySoftModifiers(
  scored: ScoredTitle[],
  dna: DNASchema,
  sessionContext?: SessionContext
): ScoredTitle[] {
  const { soft_preferences, temporal_modifiers } = dna.contextual_logic

  return scored
    .map(item => {
      let score = item.composite_score
      const applied: ScoredTitle['soft_preferences_applied'] = []

      // ── Soft preferences ────────────────────────────────
      for (const pref of soft_preferences) {
        const signal = pref.signal.toLowerCase()
        const modifier = pref.weight_modifier

        // Check if any genre or tone_tag on this title matches the preference signal
        const titleTerms = [
          ...item.title.genres.map(g => g.name.toLowerCase()),
          ...item.title.tone_tags.map(t => t.toLowerCase()),
        ]
        const matches = titleTerms.some(term => term.includes(signal) || signal.includes(term))

        if (matches) {
          score *= modifier
          applied.push({ signal: pref.signal, modifier })
        }
      }

      // ── Temporal modifiers (session override) ────────────
      if (sessionContext?.session_override_active) {
        const moodSignal = sessionContext.current_mood_signal?.toLowerCase() ?? ''

        for (const mod of temporal_modifiers) {
          if (!moodSignal.includes(mod.condition.toLowerCase())) continue

          // Boost: amplify titles with the boosted dimension/tone
          if (mod.boost) {
            const boostTerm = mod.boost.toLowerCase()
            const pacingMatch = item.title.pacing_tag?.includes(boostTerm)
            const toneMatch   = item.title.tone_tags.some(t => t.toLowerCase().includes(boostTerm))
            if (pacingMatch || toneMatch) {
              score = Math.min(1.0, score * 1.15)
              applied.push({ signal: `temporal: ${mod.condition} → boost ${mod.boost}`, modifier: 1.15 })
            }
          }

          // Suppress: reduce score for titles with the suppressed dimension/tone
          if (mod.suppress) {
            const suppressTerm = mod.suppress.toLowerCase()
            const pacingMatch = item.title.pacing_tag?.includes(suppressTerm)
            const toneMatch   = item.title.tone_tags.some(t => t.toLowerCase().includes(suppressTerm))
            if (pacingMatch || toneMatch) {
              score *= 0.70
              applied.push({ signal: `temporal: ${mod.condition} → suppress ${mod.suppress}`, modifier: 0.70 })
            }
          }
        }
      }

      return {
        ...item,
        composite_score: score,
        soft_preferences_applied: applied,
      }
    })
    .sort((a, b) => b.composite_score - a.composite_score)
}
