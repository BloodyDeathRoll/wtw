/**
 * Crew Affinity Scorer — Step 2, weight 0.35
 *
 * For each role on the title, looks up the crew member in the user's
 * strand_a and computes a weighted score. Unknown crew contribute a
 * neutral 0.0 to the raw sum, so a title with unfamiliar crew lands at
 * 0.5 (neutral) rather than 0.
 *
 * Lineage boost is computed separately (lineage-boost.ts) and added on
 * top of this score before entering the composite formula.
 *
 * Role weights (from spec):
 *   director       0.40
 *   writer         0.30
 *   cinematographer 0.15
 *   cast (top 3)   0.15
 *
 * Score arithmetic:
 *   per-person raw  = entry.score × entry.confidence   → [-1.0, 1.0]
 *   per-role raw    = the strongest per-person raw (largest |raw|);
 *                     unknown people don't count (was: average over the
 *                     role incl. unknowns as 0 — changed 2026-08-28)
 *   weighted raw    = Σ (role_raw × role_weight)        → [-1.0, 1.0]
 *   final score     = (weighted_raw + 1) / 2            → [0.0, 1.0]
 */

import type { StrandA, CrewAffinityEntry, ReasonPayload } from '@/types/dna'
import type { TMDBCrewSnapshot } from '@/lib/tmdb'
import { REACTION_SCORE } from '@/modules/dna/lib/reaction-score'

export interface CrewAffinityResult {
  score: number                              // 0.0 – 1.0
  crew_matches: ReasonPayload['crew_matches'] // passed through to reason_payload
}

const ROLE_WEIGHTS = {
  director:       0.40,
  writer:         0.30,
  cinematographer: 0.15,
  actor:          0.15,
} as const

/**
 * A strand_a entry's `score` is the running average reaction level
 * (update-crew.ts): "always loved" converges on REACTION_SCORE.loved (+0.30),
 * "always disliked" on REACTION_SCORE.disliked (−0.20). Used raw, the whole
 * component lived in 0.45–0.58 (measured 2026-08-28: a 20-title actor
 * affinity reached 0.2 after confidence) and 35% of the composite decided
 * nothing. Map that natural range to [-1, 1] before applying confidence.
 */
function normalizeAffinity(entry: CrewAffinityEntry): number {
  const ceiling = entry.score >= 0 ? REACTION_SCORE.loved : -REACTION_SCORE.disliked
  const level = Math.max(-1, Math.min(1, entry.score / ceiling))
  return level * entry.confidence
}

/**
 * Compute crew affinity score for a single title.
 * Pure function — no I/O.
 */
export function computeCrewAffinity(
  crew: TMDBCrewSnapshot,
  strandA: StrandA
): CrewAffinityResult {
  const crew_matches: ReasonPayload['crew_matches'] = []

  function roleRaw(
    crewList: { tmdb_person_id: string; name: string }[],
    affinityMap: Record<string, CrewAffinityEntry>,
    role: string,
    limit = crewList.length
  ): number {
    const persons = crewList.slice(0, limit)
    if (persons.length === 0) return 0

    // Strongest signal wins, not the average: averaging over the whole cast
    // let one known director at 0.30 get diluted by five unknown writers to
    // ~0.03, so every candidate scored 0.50 and this 35% component decided
    // nothing (measured 2026-08-28: 424/424 candidates at exactly 0.50).
    // Unknown people are simply not evidence — no boost, no penalty, no dilution.
    let strongest = 0
    for (const person of persons) {
      const entry = affinityMap[person.tmdb_person_id]
      if (entry) {
        const raw = normalizeAffinity(entry)
        if (Math.abs(raw) > Math.abs(strongest)) strongest = raw
        crew_matches.push({ name: person.name, role, affinity_score: raw })
      }
    }
    return strongest
  }

  const dirRaw  = roleRaw(crew.directors,        strandA.directors,        'director')
  const writRaw = roleRaw(crew.writers,           strandA.writers,          'writer')
  const dpRaw   = roleRaw(crew.cinematographers,  strandA.cinematographers, 'cinematographer')
  const castRaw = roleRaw(crew.cast,              strandA.actors,           'actor', 3)

  // Weighted sum in [-1, 1]
  const weighted =
    dirRaw  * ROLE_WEIGHTS.director +
    writRaw * ROLE_WEIGHTS.writer +
    dpRaw   * ROLE_WEIGHTS.cinematographer +
    castRaw * ROLE_WEIGHTS.actor

  // Normalize to [0, 1]: 0 weighted → 0.5 (neutral), +1 → 1.0, -1 → 0.0
  const score = (weighted + 1) / 2

  return { score, crew_matches }
}
