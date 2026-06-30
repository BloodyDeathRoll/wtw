import type { StrandA, Reaction } from '@/types/dna'
import type { TitleCrew } from './load-save'
import { REACTION_SCORE, confidenceDelta, clamp, lineageBoost } from './reaction-score'

// Only top-billed cast affect affinity — avoids polluting strand_a with bit parts
const MAX_CAST = 3

export function applyCrewAffinityUpdate(
  strand_a: StrandA,
  crew: TitleCrew,
  reaction: Reaction,
  scoreDeltaOverride?: number,  // used for small regret/glad nudges
): void {
  const delta = scoreDeltaOverride ?? REACTION_SCORE[reaction]

  const groups: Array<{
    pool:   { tmdb_person_id: string; name: string }[]
    bucket: keyof StrandA
  }> = [
    { pool: crew.directors        ?? [],                    bucket: 'directors'        },
    { pool: crew.writers          ?? [],                    bucket: 'writers'          },
    { pool: crew.cinematographers ?? [],                    bucket: 'cinematographers' },
    { pool: (crew.cast ?? []).slice(0, MAX_CAST),           bucket: 'actors'           },
  ]

  for (const { pool, bucket } of groups) {
    for (const member of pool) {
      const existing = strand_a[bucket][member.tmdb_person_id]

      if (!existing) {
        strand_a[bucket][member.tmdb_person_id] = {
          name:          member.name,
          score:         clamp(delta, -1, 1),
          confidence:    0.15,
          sample_size:   1,
          lineage_boost: lineageBoost(delta),
        }
      } else {
        const newScore = clamp(
          (existing.score * existing.sample_size + delta) / (existing.sample_size + 1),
          -1, 1,
        )
        // Smaller confidence delta for nudges (regret/glad) vs full signals
        const confDelta = scoreDeltaOverride != null
          ? (scoreDeltaOverride > 0 ? +0.03 : -0.03)
          : confidenceDelta(existing.score, delta)

        existing.score         = newScore
        existing.confidence    = clamp(existing.confidence + confDelta, 0, 1)
        existing.sample_size  += 1
        existing.lineage_boost = lineageBoost(newScore)
      }
    }
  }
}
