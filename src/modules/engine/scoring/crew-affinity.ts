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
 *   per-role raw    = average of per-person raws (unknowns = 0.0)
 *   weighted raw    = Σ (role_raw × role_weight)        → [-1.0, 1.0]
 *   final score     = (weighted_raw + 1) / 2            → [0.0, 1.0]
 */

import type { StrandA, CrewAffinityEntry, ReasonPayload } from '@/types/dna'
import type { TMDBCrewSnapshot } from '@/lib/tmdb'

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

    let sum = 0
    for (const person of persons) {
      const entry = affinityMap[person.tmdb_person_id]
      if (entry) {
        const raw = entry.score * entry.confidence
        sum += raw
        crew_matches.push({ name: person.name, role, affinity_score: raw })
      }
      // Unknown person: contributes 0.0 (neutral — no boost, no penalty)
    }
    return sum / persons.length
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
