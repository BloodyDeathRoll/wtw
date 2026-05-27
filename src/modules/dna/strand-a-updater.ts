import type { StrandA, CrewAffinityEntry, DNASignal, LineageBoost } from '@/types/dna'

/**
 * Crew data resolved from TMDB for a single signal.
 * The writer fetches this before calling updateStrandA.
 */
export interface ResolvedCrew {
  tmdb_id: string
  name: string
  role: 'director' | 'writer' | 'cinematographer' | 'actor'
}

/** Score delta applied per reaction type */
const REACTION_DELTA: Record<DNASignal['reaction'], number> = {
  loved:    0.15,
  liked:    0.08,
  mixed:    -0.03,
  disliked: -0.12,
}

/** Confidence delta — increases on corroboration, decreases on contradiction */
const CONFIDENCE_CORROBORATE = 0.08
const CONFIDENCE_CONTRADICT  = 0.05
const CONFIDENCE_NEW_ENTRY   = 0.10

/**
 * Score thresholds that determine lineage_boost level.
 * Above each threshold, the boost level applies.
 */
const LINEAGE_THRESHOLDS: { min: number; boost: LineageBoost }[] = [
  { min: 0.7,       boost: 'high'   },
  { min: 0.45,      boost: 'medium' },
  { min: 0.2,       boost: 'low'    },
  { min: -Infinity, boost: 'none'   },
]

/**
 * Updates Strand A (crew affinity) based on new signals and their resolved crew.
 *
 * Pure function — returns updated StrandA, does not mutate input.
 *
 * @param current   - Existing StrandA from the user's DNA
 * @param signals   - New signals from the session
 * @param crewMap   - Map from tmdb_id (title) → resolved crew members for that title
 */
export function updateStrandA(
  current: StrandA,
  signals: DNASignal[],
  crewMap: Map<string, ResolvedCrew[]>,
): StrandA {
  // Deep-clone to avoid mutating the input
  const updated: StrandA = {
    directors:        { ...current.directors },
    writers:          { ...current.writers },
    cinematographers: { ...current.cinematographers },
    actors:           { ...current.actors },
  }

  for (const signal of signals) {
    const crew = crewMap.get(signal.tmdb_id) ?? []
    for (const member of crew) {
      applyCrewSignal(updated, member, signal.reaction)
    }
  }

  return updated
}

// ─── internals ───────────────────────────────────────────────────────────────

function applyCrewSignal(
  strand: StrandA,
  member: ResolvedCrew,
  reaction: DNASignal['reaction'],
): void {
  const bucket  = strandBucket(strand, member.role)
  const delta   = REACTION_DELTA[reaction]
  const existing = bucket[member.tmdb_id]

  if (!existing) {
    bucket[member.tmdb_id] = {
      name:          member.name,
      score:         clampScore(delta),
      confidence:    CONFIDENCE_NEW_ENTRY,
      sample_size:   1,
      lineage_boost: computeLineageBoost(clampScore(delta)),
    }
    return
  }

  const newScore = clampScore(existing.score + delta)
  const isCorroborating =
    Math.sign(delta) === Math.sign(existing.score) || existing.score === 0
  const confidenceDelta = isCorroborating
    ? CONFIDENCE_CORROBORATE
    : -CONFIDENCE_CONTRADICT

  const updated: CrewAffinityEntry = {
    name:          member.name,
    score:         newScore,
    confidence:    clamp(existing.confidence + confidenceDelta, 0, 1),
    sample_size:   existing.sample_size + 1,
    lineage_boost: computeLineageBoost(newScore),
  }

  bucket[member.tmdb_id] = updated
}

function strandBucket(
  strand: StrandA,
  role: ResolvedCrew['role'],
): Record<string, CrewAffinityEntry> {
  switch (role) {
    case 'director':        return strand.directors
    case 'writer':          return strand.writers
    case 'cinematographer': return strand.cinematographers
    case 'actor':           return strand.actors
  }
}

function computeLineageBoost(score: number): LineageBoost {
  for (const { min, boost } of LINEAGE_THRESHOLDS) {
    if (score >= min) return boost
  }
  return 'none'
}

function clampScore(v: number): number {
  return clamp(v, -1, 1)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}
