/**
 * The taste games' sync marker — what the last sync put into the DNA, stored
 * at `metadata.play_sync` (src/types/dna.ts) and read back by
 * update-from-play.ts (to retract it) and by the engine's cold start (to know
 * the season was finished). Kept apart from the sync itself so a reader
 * pulls in a type and a guard, not the DNA writers.
 */
import type { DNASchema, StrandB, StrandC } from '@/types/dna'
import type { GameGenre } from '@/app/play/lib/genres'

/** One running-average contribution: `n` samples at reaction level `delta`. */
export interface Applied { delta: number; n: number; conf: number }

export interface PlayDnaMarker {
  v: 1
  /** The state this was derived from — what `needsSync` compares. */
  sel: GameGenre[] | null
  block: number
  round: number
  done: boolean
  skipped: boolean
  /** genre_affinity key → contribution. */
  genres: Record<string, Applied>
  /** language_affinity key → contribution (anime love → 'ja'). */
  languages: Record<string, Applied>
  /** exclusion_rules ids this sync owns. */
  rules: string[]
  /** Deltas added to the weight groups. */
  pacing: Partial<Record<keyof StrandC['pacing_weights'], number>>
  tone: Partial<Record<keyof StrandC['tone_weights'], number>>
  /** Per strand_b dimension: what was there before, and what the games set. */
  strandB: Partial<Record<keyof StrandB, { prior: { value: StrandB[keyof StrandB]['value']; confidence: number }; set: { value: StrandB[keyof StrandB]['value']; confidence: number } }>>
  /** `${bucket}:${tmdb_person_id}` → contribution. */
  crew: Record<string, Applied & { name: string }>
}

export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isApplied = (x: unknown): x is Applied => isObj(x) && fin(x.delta) && fin(x.n) && fin(x.conf)

/**
 * The stored marker, or null when absent or not something this code wrote.
 * Every number the retraction will subtract is checked: a corrupt marker
 * yields null, and null means "retract nothing", which is the safe failure
 * (a NaN in a running average would poison the entry for good).
 */
export function readMarker(dna: DNASchema): PlayDnaMarker | null {
  const m = dna.metadata.play_sync
  if (!isObj(m) || m.v !== 1) return null
  if (!Array.isArray(m.rules) || !m.rules.every(r => typeof r === 'string')) return null
  if (!fin(m.block) || !fin(m.round) || typeof m.done !== 'boolean' || typeof m.skipped !== 'boolean') return null
  if (m.sel !== null && !(Array.isArray(m.sel) && m.sel.every(g => typeof g === 'string'))) return null
  for (const k of ['genres', 'languages', 'crew'] as const) {
    if (!isObj(m[k]) || !Object.values(m[k] as object).every(isApplied)) return null
  }
  // TMDB person ids are numeric; the key is split on ':' when retracting.
  if (!Object.keys(m.crew as object).every(k => /^(directors|writers|cinematographers|actors):\d+$/.test(k))) return null
  // Keys too: an unknown tag would be written back as NaN, an unknown
  // dimension would throw on retraction. The allowed names are the DNA's own
  // keys, so a tag added to the contract later is accepted the day it lands.
  const PACING = Object.keys(dna.strand_c_visceral_specs.pacing_weights)
  const TONES  = Object.keys(dna.strand_c_visceral_specs.tone_weights)
  const DIMS   = Object.keys(dna.strand_b_narrative_dimensions)
  for (const [k, allowed] of [['pacing', PACING], ['tone', TONES]] as const) {
    if (!isObj(m[k])) return null
    for (const [tag, d] of Object.entries(m[k] as object)) if (!allowed.includes(tag) || !fin(d)) return null
  }
  if (!isObj(m.strandB)) return null
  for (const [dim, rec] of Object.entries(m.strandB as object)) {
    if (!DIMS.includes(dim)) return null
    if (!isObj(rec) || !isObj(rec.prior) || !isObj(rec.set) || !fin(rec.prior.confidence) || !fin(rec.set.confidence)) return null
  }
  return m as unknown as PlayDnaMarker
}
