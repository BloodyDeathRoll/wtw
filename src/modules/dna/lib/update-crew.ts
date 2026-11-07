import type { StrandA, Reaction } from '@/types/dna'
import type { TitleCrew } from './load-save'
import { REACTION_SCORE, confidenceDelta, clamp, lineageBoost } from './reaction-score'

// Only top-billed cast affect affinity — avoids polluting strand_a with bit parts
const MAX_CAST = 3

/**
 * A dislike leaves people alone (Eran, 2026-11-07): a bad film says little
 * about the people in it, so only loved and liked move a director, writer,
 * actor or cinematographer. Every rule below follows this: a disliked title
 * adds nothing to people, so it has nothing to swap or take back out either.
 * The 48-hour check-in's small nudges (scoreDeltaOverride) are their own
 * signal and still apply.
 */
export function movesPeople(reaction: Reaction): boolean {
  return reaction === 'loved' || reaction === 'liked'
}

export function applyCrewAffinityUpdate(
  strand_a: StrandA,
  crew: TitleCrew,
  reaction: Reaction,
  scoreDeltaOverride?: number,  // used for small regret/glad nudges
): void {
  if (scoreDeltaOverride == null && !movesPeople(reaction)) return
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
    // One update per person per title: TMDB credits a writer once per job
    // ("Screenplay" + "Story") and titles.crew keeps every credit, so the same
    // id can appear twice in one role. sample_size counts titles, not credits.
    const seen = new Set<string>()
    for (const member of pool) {
      if (seen.has(member.tmdb_person_id)) continue
      seen.add(member.tmdb_person_id)
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

/**
 * Re-rate: swap a title's earlier reaction for the user's new one. The running
 * average already holds the old contribution, so take it out and put the new
 * one in — `sample_size` is unchanged, because it is still one title. A person
 * with no entry (crew changed since, or never scored) gets a fresh one.
 * Confidence is left as is: the user's correction is not extra evidence.
 */
export function replaceCrewAffinity(
  strand_a: StrandA,
  crew: TitleCrew,
  previous: Reaction,
  reaction: Reaction,
): void {
  // A dislike on either side added or adds nothing to people (movesPeople):
  // disliked → loved is a first rating for them, loved → disliked takes the
  // loved one back out, disliked → disliked changes nothing.
  if (!movesPeople(previous)) {
    applyCrewAffinityUpdate(strand_a, crew, reaction)
    return
  }
  if (!movesPeople(reaction)) {
    removeCrewAffinity(strand_a, crew, previous)
    return
  }
  const swing = REACTION_SCORE[reaction] - REACTION_SCORE[previous]

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
    const seen = new Set<string>()
    for (const member of pool) {
      if (seen.has(member.tmdb_person_id)) continue
      seen.add(member.tmdb_person_id)
      const existing = strand_a[bucket][member.tmdb_person_id]

      if (!existing) {
        const delta = REACTION_SCORE[reaction]
        strand_a[bucket][member.tmdb_person_id] = {
          name:          member.name,
          score:         clamp(delta, -1, 1),
          confidence:    0.15,
          sample_size:   1,
          lineage_boost: lineageBoost(delta),
        }
      } else {
        existing.score         = clamp(existing.score + swing / existing.sample_size, -1, 1)
        existing.lineage_boost = lineageBoost(existing.score)
      }
    }
  }
}

/**
 * Un-rate: take a title's reaction back out of each person's running average,
 * as if it had never been rated. A person whose only title this was is
 * dropped (they were only ever known from it). The score is exact, bar the
 * [-1, 1] clamp; confidence has no record of what this title added, so it
 * stays — it is a hint for the DNA page, not part of the score.
 */
export function removeCrewAffinity(
  strand_a: StrandA,
  crew: TitleCrew,
  previous: Reaction,
): void {
  if (!movesPeople(previous)) return // a dislike never added anything
  removeCrewDelta(strand_a, crew, REACTION_SCORE[previous])
}

/**
 * Take one title's `delta` back out of each of its people's running averages.
 * removeCrewAffinity's arithmetic, exported on its own for
 * scripts/remove-dislikes-from-people.mts, which takes out the dislikes
 * applied before 2026-11-07.
 */
export function removeCrewDelta(
  strand_a: StrandA,
  crew: TitleCrew,
  delta: number,
): void {
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
    const seen = new Set<string>()
    for (const member of pool) {
      if (seen.has(member.tmdb_person_id)) continue
      seen.add(member.tmdb_person_id)
      const existing = strand_a[bucket][member.tmdb_person_id]
      if (!existing) continue
      if (existing.sample_size <= 1) {
        delete strand_a[bucket][member.tmdb_person_id]
        continue
      }
      const n = existing.sample_size
      existing.score         = clamp((existing.score * n - delta) / (n - 1), -1, 1)
      existing.sample_size   = n - 1
      existing.lineage_boost = lineageBoost(existing.score)
    }
  }
}
