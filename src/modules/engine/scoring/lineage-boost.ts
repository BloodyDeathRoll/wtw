/**
 * Lineage Boost — Step 2, part of crew_affinity_score
 *
 * For every crew member in the user's strand_a with lineage_boost
 * 'medium' or 'high', traverse their creative influence graph up to
 * 2 degrees and check whether any influenced person worked on this title.
 *
 * Degree weights (from spec):
 *   Degree 1 (X influenced Y; Y is on the title):  × 0.50
 *   Degree 2 (X influenced Y, Y influenced Z; Z on the title): × 0.25
 *
 * Boost per connection = source_person.score × source_person.confidence × degree_weight
 * Total boost is capped at 0.4 (it's additive on top of crew_affinity_score).
 *
 * Requires 2 DB queries:
 *   1. Fetch lineage for all boost-eligible strand_a crew
 *   2. Fetch lineage for all degree-1 matches (for degree-2 traversal)
 *
 * Returns the boost value plus lineage_connections for the reason_payload.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { StrandA, ReasonPayload } from '@/types/dna'
import type { TMDBCrewSnapshot } from '@/lib/tmdb'

// ─────────────────────────────────────────────
// Batch-friendly API (used by Step 2 pipeline)
// ─────────────────────────────────────────────

export type LineageCache = Map<string, LineageRecord>

/**
 * Collects TMDB person IDs from strand_a that have lineage_boost set.
 * Pure function — used by the pipeline to know what to pre-fetch.
 */
export function getBoostEligibleIds(strandA: StrandA): string[] {
  const ids: string[] = []
  for (const role of ['directors', 'writers', 'cinematographers'] as const) {
    for (const [id, entry] of Object.entries(strandA[role])) {
      if (entry.lineage_boost === 'medium' || entry.lineage_boost === 'high') {
        ids.push(id)
      }
    }
  }
  return ids
}

/**
 * Fetches lineage data for a set of person IDs in one query.
 * Call twice: once for degree-1 persons, once for degree-2.
 */
export async function fetchLineageCache(personIds: string[]): Promise<LineageCache> {
  if (personIds.length === 0) return new Map()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('crew_members')
    .select('tmdb_person_id, lineage_influences')
    .in('tmdb_person_id', personIds)
  return new Map(
    ((data ?? []) as LineageRecord[]).map(r => [r.tmdb_person_id, r])
  )
}

/**
 * Compute lineage boost from pre-fetched caches. Pure function — no I/O.
 * Used by the pipeline to score all 200 candidates without additional DB calls.
 *
 * @param d1Cache  lineage of boost-eligible strand_a crew
 * @param d2Cache  lineage of degree-1 matched persons
 */
export function computeBoostFromCaches(
  crew: TMDBCrewSnapshot,
  strandA: StrandA,
  d1Cache: LineageCache,
  d2Cache: LineageCache
): LineageBoostResult {
  const titleCrewIds = new Set([
    ...crew.directors.map(d => d.tmdb_person_id),
    ...crew.writers.map(w => w.tmdb_person_id),
    ...crew.cinematographers.map(dp => dp.tmdb_person_id),
  ])

  const lineage_connections: ReasonPayload['lineage_connections'] = []
  let totalBoost = 0

  for (const [role, crewList] of [
    ['directors', crew.directors] as const,
    ['writers', crew.writers] as const,
    ['cinematographers', crew.cinematographers] as const,
  ]) {
    for (const person of crewList) {
      const entry = strandA[role][person.tmdb_person_id]
      if (!entry || (entry.lineage_boost !== 'medium' && entry.lineage_boost !== 'high')) continue

      const baseStrength = entry.score * entry.confidence
      const lineageRow = d1Cache.get(person.tmdb_person_id)
      if (!lineageRow) continue

      for (const influenced of (lineageRow.lineage_influences.influences ?? [])) {
        if (!influenced.id) continue

        if (titleCrewIds.has(influenced.id)) {
          totalBoost += baseStrength * DEGREE_1_WEIGHT
          lineage_connections.push({ from: person.name, to: influenced.name, relationship: influenced.relationship })
        }

        // Degree-2: check if influenced's influences are on the title
        const d2Row = d2Cache.get(influenced.id)
        for (const d2 of (d2Row?.lineage_influences.influences ?? [])) {
          if (d2.id && titleCrewIds.has(d2.id)) {
            totalBoost += baseStrength * DEGREE_2_WEIGHT
            lineage_connections.push({ from: influenced.name, to: d2.name, relationship: d2.relationship })
          }
        }
      }
    }
  }

  return { boost: Math.min(MAX_BOOST, totalBoost), lineage_connections }
}

export interface LineageBoostResult {
  boost: number                                           // 0.0 – 0.4, added to crew_affinity_score
  lineage_connections: ReasonPayload['lineage_connections']
}

const DEGREE_1_WEIGHT = 0.50
const DEGREE_2_WEIGHT = 0.25
const MAX_BOOST       = 0.40

interface LineageEntry {
  id: string
  name: string
  relationship: string
}
interface LineageRecord {
  tmdb_person_id: string
  lineage_influences: {
    influenced_by: LineageEntry[]
    influences:    LineageEntry[]
  }
}

/**
 * Compute lineage boost for a single title candidate.
 * Returns {boost: 0, lineage_connections: []} quickly when no strand_a
 * crew has lineage_boost set (the common case for new users).
 */
export async function computeLineageBoost(
  crew: TMDBCrewSnapshot,
  strandA: StrandA
): Promise<LineageBoostResult> {

  // ── Collect boost-eligible strand_a crew ──────────────────
  // Only directors, writers, cinematographers carry lineage_boost.
  // Actors are excluded per spec.
  type EligiblePerson = {
    tmdb_person_id: string
    name: string
    score: number
    confidence: number
  }

  const eligible: EligiblePerson[] = []

  const rolesAndCrew: [keyof StrandA, { tmdb_person_id: string; name: string }[]][] = [
    ['directors',       crew.directors],
    ['writers',         crew.writers],
    ['cinematographers', crew.cinematographers],
  ]

  for (const [role, crewList] of rolesAndCrew) {
    for (const person of crewList) {
      const entry = strandA[role][person.tmdb_person_id]
      if (entry && (entry.lineage_boost === 'medium' || entry.lineage_boost === 'high')) {
        eligible.push({
          tmdb_person_id: person.tmdb_person_id,
          name: person.name,
          score: entry.score,
          confidence: entry.confidence,
        })
      }
    }
  }

  if (eligible.length === 0) return { boost: 0, lineage_connections: [] }

  // ── Build title crew ID set for fast membership check ─────
  const titleCrewIds = new Set([
    ...crew.directors.map(d => d.tmdb_person_id),
    ...crew.writers.map(w => w.tmdb_person_id),
    ...crew.cinematographers.map(dp => dp.tmdb_person_id),
  ])

  const supabase = createServiceClient()

  // ── Degree-1: fetch lineage for all eligible persons ──────
  const eligibleIds = eligible.map(e => e.tmdb_person_id)
  const { data: d1Rows } = await supabase
    .from('crew_members')
    .select('tmdb_person_id, lineage_influences')
    .in('tmdb_person_id', eligibleIds)

  const d1Map = new Map<string, LineageRecord>(
    ((d1Rows ?? []) as LineageRecord[]).map(r => [r.tmdb_person_id, r])
  )

  const lineage_connections: ReasonPayload['lineage_connections'] = []
  let totalBoost = 0

  // People on the title at degree-1 that we need degree-2 for
  const degree1Matches: { id: string; name: string }[] = []

  for (const person of eligible) {
    const lineage = d1Map.get(person.tmdb_person_id)
    if (!lineage) continue

    const baseStrength = person.score * person.confidence

    for (const influenced of (lineage.lineage_influences.influences ?? [])) {
      if (!influenced.id) continue

      if (titleCrewIds.has(influenced.id)) {
        // Degree-1 hit: a person influenced by this strand_a person is on the title
        totalBoost += baseStrength * DEGREE_1_WEIGHT
        lineage_connections.push({
          from: person.name,
          to: influenced.name,
          relationship: influenced.relationship,
        })
      }
      // Collect for degree-2 traversal regardless of title match
      degree1Matches.push({ id: influenced.id, name: influenced.name })
    }
  }

  // ── Degree-2: fetch lineage for degree-1 persons ──────────
  const d2Ids = [...new Set(degree1Matches.map(p => p.id))].filter(Boolean)

  if (d2Ids.length > 0) {
    const { data: d2Rows } = await supabase
      .from('crew_members')
      .select('tmdb_person_id, lineage_influences')
      .in('tmdb_person_id', d2Ids)

    const d2Map = new Map<string, LineageRecord>(
      ((d2Rows ?? []) as LineageRecord[]).map(r => [r.tmdb_person_id, r])
    )

    // For degree-2 boost strength: use max eligible person's strength
    // (tracking per-path would be complex; max is a reasonable approximation)
    const maxBaseStrength = Math.max(...eligible.map(e => e.score * e.confidence))

    for (const d1Person of degree1Matches) {
      const d2Lineage = d2Map.get(d1Person.id)
      if (!d2Lineage) continue

      for (const d2 of (d2Lineage.lineage_influences.influences ?? [])) {
        if (!d2.id || !titleCrewIds.has(d2.id)) continue

        totalBoost += maxBaseStrength * DEGREE_2_WEIGHT
        lineage_connections.push({
          from: d1Person.name,
          to: d2.name,
          relationship: d2.relationship,
        })
      }
    }
  }

  return {
    boost: Math.min(MAX_BOOST, totalBoost),
    lineage_connections,
  }
}
