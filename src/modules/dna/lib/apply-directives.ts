/**
 * Merge the standing instructions a session extracted into contextual_logic.
 *
 * Before this, dna.contextual_logic.exclusion_rules had exactly one writer —
 * POST /api/dna/parse-instruction — and nothing in the app ever called it. A
 * user could say "no anime" in every turn of every session, be told "got it",
 * and never have a rule written (2026-08-29).
 *
 * Rules are identified by type + name (src/lib/exclusion-rules.ts `ruleKey`),
 * so repeating an instruction across sessions updates the existing rule rather
 * than stacking duplicates. An instruction that arrives as an exclusion when a
 * soft preference of the same name exists is an escalation: the hard rule wins
 * and the soft one is dropped.
 */

import { ruleKey } from '@/lib/exclusion-rules'
import type { ContextualLogic, SessionDirective } from '@/types/dna'

export interface DirectiveMergeResult {
  exclusions_added: number
  soft_preferences_added: number
}

export function applyDirectives(
  logic: ContextualLogic,
  directives: SessionDirective[] | undefined,
): DirectiveMergeResult {
  const result: DirectiveMergeResult = { exclusions_added: 0, soft_preferences_added: 0 }
  if (!directives?.length) return result

  for (const d of directives) {
    const name = d.name?.trim()
    if (!name) continue

    if (d.kind === 'exclusion') {
      const key = ruleKey({ type: d.target_type, name })
      const existing = logic.exclusion_rules.find(r => ruleKey(r) === key)
      if (existing) {
        // Re-stating a rule can only improve it: keep a person id we now have.
        if (!existing.id && d.person_id) existing.id = d.person_id
        continue
      }
      logic.exclusion_rules.push({
        type: d.target_type,
        id: d.person_id ?? '',
        name,
        raw: d.raw || name,
        reason: d.reason || '',
      })
      result.exclusions_added++

      // Escalation: a hard rule supersedes a softer one about the same thing.
      const before = logic.soft_preferences.length
      logic.soft_preferences = logic.soft_preferences.filter(
        p => p.signal.trim().toLowerCase() !== name.toLowerCase(),
      )
      if (logic.soft_preferences.length !== before) {
        console.log(`[directives] "${name}" escalated from soft preference to exclusion`)
      }
      continue
    }

    // Soft preference. Never downgrade something already excluded outright.
    const excluded = logic.exclusion_rules.some(
      r => r.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (excluded) continue

    const weight = typeof d.weight_modifier === 'number' ? d.weight_modifier : 0.5
    const existing = logic.soft_preferences.find(
      p => p.signal.trim().toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      // Say it again and you mean it more — keep the stronger reduction.
      existing.weight_modifier = Math.min(existing.weight_modifier, weight)
      continue
    }
    logic.soft_preferences.push({ signal: name, weight_modifier: weight })
    result.soft_preferences_added++
  }

  return result
}
