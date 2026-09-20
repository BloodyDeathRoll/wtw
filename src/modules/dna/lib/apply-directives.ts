/**
 * Merge the standing instructions a session extracted into contextual_logic.
 *
 * Before this, dna.contextual_logic.exclusion_rules had exactly one writer —
 * POST /api/dna/parse-instruction — which nothing in the app ever called (it
 * has since been deleted; it wrote person rules with an empty id too). A
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
  /**
   * An existing rule or preference was changed in place — a hedge tightened, a
   * person id filled in. Separate from the "added" counts because a caller
   * deciding whether to persist has to know about both, and a caller deciding
   * what to TELL the user wants to know it was not new.
   *
   * Added 2026-09-20: callers used to save only when an added count moved, so
   * saying "less romance" over an existing weaker preference computed the
   * tighter weight and then dropped it on the floor.
   */
  updated: number
}

export function applyDirectives(
  logic: ContextualLogic,
  directives: SessionDirective[] | undefined,
): DirectiveMergeResult {
  const result: DirectiveMergeResult = { exclusions_added: 0, soft_preferences_added: 0, updated: 0 }
  if (!directives?.length) return result

  for (const d of directives) {
    const name = d.name?.trim()
    if (!name) continue

    if (d.kind === 'exclusion') {
      const key = ruleKey({ type: d.target_type, name })
      const existing =
        logic.exclusion_rules.find(r => ruleKey(r) === key) ??
        // A name typed on the Taste DNA page is never classified as a person,
        // so a rule already stored as one is invisible to a type+name lookup —
        // and the soft preference that carried the identity was consumed by
        // the first escalation. Without this the second "Never show me Adam
        // Sandler" pushes a duplicate, inert keyword rule beside the working
        // one. One direction only: a genuine person directive must never
        // silently attach itself to a keyword rule of the same name.
        (d.target_type !== 'person'
          ? logic.exclusion_rules.find(r => ruleKey(r) === ruleKey({ type: 'person', name }))
          : undefined)
      if (existing) {
        // Re-stating a rule can only improve it: keep a person id we now have.
        if (!existing.id && d.person_id) {
          existing.id = d.person_id
          result.updated++
        }
        continue
      }

      // Escalation: a hard rule supersedes a softer one about the same thing.
      // Find it FIRST, because a soft preference about a person carries the
      // identity that makes a rule about that person work at all — and the
      // caller may not have it. A rule typed on the Taste DNA page is never
      // classified as a person (a name guessed from free text is unmatchable),
      // so escalating "Adam Sandler" over a person preference used to delete
      // the one entry that matched him and leave an inert keyword rule
      // standing in its place, reported to the user as applied.
      const softIndex = logic.soft_preferences.findIndex(
        p => p.signal.trim().toLowerCase() === name.toLowerCase(),
      )
      const superseded = softIndex >= 0 ? logic.soft_preferences[softIndex] : null
      if (superseded) {
        logic.soft_preferences.splice(softIndex, 1)
        console.log(`[directives] "${name}" escalated from soft preference to exclusion`)
      }

      const inheritPerson = superseded?.target_type === 'person'
      logic.exclusion_rules.push({
        type: inheritPerson ? 'person' : d.target_type,
        id: d.person_id || (inheritPerson ? superseded.person_id ?? '' : ''),
        name,
        raw: d.raw || name,
        reason: d.reason || '',
      })
      result.exclusions_added++
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
      let changed = false
      // Say it again and you mean it more — keep the stronger reduction.
      if (weight < existing.weight_modifier) {
        existing.weight_modifier = weight
        changed = true
      }
      // And keep anything the re-mention resolved that we didn't have.
      if (!existing.target_type) { existing.target_type = d.target_type; changed = true }
      if (!existing.person_id && d.person_id) { existing.person_id = d.person_id; changed = true }
      if (changed) result.updated++
      continue
    }
    logic.soft_preferences.push({
      signal: name,
      weight_modifier: weight,
      target_type: d.target_type,
      person_id: d.person_id ?? '',
    })
    result.soft_preferences_added++
  }

  return result
}

/** Did the merge change anything that has to be persisted? */
export function directivesChanged(r: DirectiveMergeResult): boolean {
  return r.exclusions_added > 0 || r.soft_preferences_added > 0 || r.updated > 0
}
