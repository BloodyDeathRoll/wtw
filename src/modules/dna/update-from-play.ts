/**
 * updateFromPlay — the taste games write the live DNA ("Slice 2", 2026-10-21).
 *
 * What the desktop "Behind the curtain" panel shows is what gets registered:
 *   - the scale beliefs (est × conf per scale)      → strand_c pacing / tone weights,
 *                                                     strand_b complexity, ambiguity,
 *                                                     humor style, originality
 *   - the genre chips (`gen`, set at setup, drifting
 *     with every pick; ≤ -5 is "Never")             → strand_c genre_affinity,
 *                                                     contextual_logic.exclusion_rules
 *   - "Creators they trust"                         → strand_a (resolved to TMDB
 *                                                     person ids through the catalog)
 *
 * The play state is a belief, not a stream of ratings, so the write is a
 * SET, done as retract-then-apply: a marker records exactly what the last
 * sync put into each field, the next sync takes that back out and puts the
 * current belief in. Ratings and chat keep writing the same fields in
 * between and are never touched. The marker lives IN the DNA
 * (`metadata.play_sync`), so the contribution and its record land in one
 * compare-and-set: two saves at the same milestone can't both retract the
 * same marker (the loser's CAS misses and it re-runs against the row that
 * already holds the new one, which is then not due), and a half-written
 * sync can't leave a contribution nothing records.
 *
 * Runs at milestones (genres set, a block finished, Skip, season done, or
 * every few picks in the games phase), each a `taste_version` bump. Rules
 * for any DNA write: docs/DNA-CONTRACT.md.
 */

import type { DNASchema, StrandB, StrandC, ContentAffinityEntry, CrewAffinityEntry, ExclusionRule } from '@/types/dna'
import { ruleKey } from '@/lib/exclusion-rules'
import { conf, est, nevers, trustedCreators, type PlayState } from '@/app/play/lib/brain'
import { seasonDone } from '@/app/play/lib/blocks'
import type { GameGenre } from '@/app/play/lib/genres'
import type { GameTitle } from '@/app/play/lib/scales'
import { withDNAUpdate, fetchTitleCrew, bumpVersion } from './lib/load-save'
import { recenterWeights } from './lib/update-strand-c'
import { confidenceDelta, clamp, lineageBoost } from './lib/reaction-score'
import { MIN_CONTENT_SAMPLES } from './lib/update-content-affinity'
import { regenerateEmbedding } from './lib/regenerate-embedding'

// ── What a sync puts in (and the next one takes out) ─────────────────────

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

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

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
  for (const k of ['pacing', 'tone'] as const) {
    if (!isObj(m[k]) || !Object.values(m[k] as object).every(fin)) return null
  }
  if (!isObj(m.strandB)) return null
  for (const rec of Object.values(m.strandB as object)) {
    if (!isObj(rec) || !isObj(rec.prior) || !isObj(rec.set) || !fin(rec.prior.confidence) || !fin(rec.set.confidence)) return null
  }
  return m as unknown as PlayDnaMarker
}

/**
 * The fields the sync reads, checked before a client-sent state is trusted
 * with them. Anything else in the state is the games' own business.
 */
export function isSyncableState(x: unknown): x is PlayState {
  if (!isObj(x) || x.v !== 3) return false
  if (x.sel !== null && !(Array.isArray(x.sel) && x.sel.every(g => typeof g === 'string'))) return false
  for (const k of ['gen', 'sw', 'sv', 'crew', 'crewSeen']) {
    if (!isObj(x[k]) || !Object.values(x[k] as object).every(v => typeof v === 'number')) return false
  }
  if (!Array.isArray(x.used) || !x.used.every(id => typeof id === 'string')) return false
  if (!Array.isArray(x.preds) || !x.preds.every(p => typeof p === 'number')) return false
  return typeof x.block === 'number' && typeof x.round === 'number'
}

// ── The games' genres → the catalog's genre names ─────────────────────────
// Lowercased TMDB genre names, movie and TV (src/app/play/lib/genres.ts has
// the reverse map). Anime is not a TMDB genre: loving it is Animation + 'ja';
// never-anime is the 'anime' rule, which exclusion-rules.ts widens.
const GENRE_NAMES: Record<GameGenre, string[]> = {
  comedy:   ['comedy'],
  drama:    ['drama'],
  action:   ['action', 'action & adventure'],
  crime:    ['crime'],
  thriller: ['thriller', 'mystery'],
  scifi:    ['science fiction', 'fantasy', 'sci-fi & fantasy'],
  horror:   ['horror'],
  romance:  ['romance'],
  anim:     ['animation'],
  anime:    ['animation'],
  doc:      ['documentary'],
  war:      ['war', 'history', 'war & politics'],
}
const NEVER_RULE_NAMES: Record<GameGenre, string[]> = { ...GENRE_NAMES, anime: ['anime'] }

/**
 * A genre chip's value → reaction level. Setup says 2 love · 1 like · 0 meh,
 * and every pick drifts it (+0.15 win, −0.08 loss). Love reads as "always
 * loved" (+0.30), like as "always liked" (+0.15), a chip drifted below 0 as
 * a dislike, capped at "always disliked" (−0.20). Meh (|gen| < 0.5) says
 * nothing. "Never" (≤ −5) is a rule, not an affinity.
 */
export function genreDelta(gen: number): number | null {
  if (gen <= -5 || Math.abs(gen) < 0.5) return null
  return gen > 0 ? Math.min(gen / 2, 1) * 0.30 : Math.max(gen / 2, -1) * 0.20
}

/** Weight of the games' genre statement, in samples: enough for the scorer to count it. */
const GENRE_SAMPLES = MIN_CONTENT_SAMPLES
/** A trusted creator (3+ wins, 75%+): two liked-to-loved titles' worth. */
const CREW_SAMPLES = 2
const CREW_DELTA   = 0.20
/** First-sighting confidence, same as strand_a / content affinity. */
const FIRST_CONFIDENCE = 0.15
/** How far a fully confident scale belief moves a weight group (recentred after). */
const WEIGHT_GAIN = 0.25
/** A scale belief below this confidence is not written anywhere. */
const MIN_SCALE_CONF = 0.3
/** strand_b confidence a fully confident scale belief carries. */
const STRAND_B_GAIN = 0.6

// ── Influence: the pure read of a play state ─────────────────────────────

export interface Influence {
  genres: Record<string, number>        // genre_affinity key → delta
  languages: Record<string, number>
  never: GameGenre[]
  pacing: Partial<Record<keyof StrandC['pacing_weights'], number>>
  tone: Partial<Record<keyof StrandC['tone_weights'], number>>
  strandB: Partial<Record<keyof StrandB, { value: StrandB[keyof StrandB]['value']; confidence: number }>>
  /** Creator names the player trusts; resolved to person ids by the sync. */
  creators: string[]
}

export function playInfluence(S: PlayState): Influence {
  const genres: Record<string, number> = {}
  const languages: Record<string, number> = {}
  for (const [g, gen] of Object.entries(S.gen) as [GameGenre, number][]) {
    const d = genreDelta(gen)
    if (d == null) continue
    for (const name of GENRE_NAMES[g]) genres[name] = Math.max(genres[name] ?? -1, d)
    if (g === 'anime') languages.ja = d
  }

  const belief = (a: Parameters<typeof est>[1]) => {
    const c = conf(S, a)
    return c >= MIN_SCALE_CONF ? { e: est(S, a), c } : null
  }

  // Weights: a closed set where only the order matters, so a belief is a push
  // on one tag and a pull on its opposite, scaled by confidence.
  const pacing: Influence['pacing'] = {}
  const tone: Influence['tone'] = {}
  const pace = belief('pace'), energy = belief('energy')
  if (pace || energy) {
    const e = ((pace?.e ?? 0) + (energy?.e ?? 0)) / ((pace ? 1 : 0) + (energy ? 1 : 0))
    const c = Math.max(pace?.c ?? 0, energy?.c ?? 0)
    const k = r2(WEIGHT_GAIN * c * e)
    pacing.high_octane = k
    pacing.slow_burn = -k
  }
  const funny = belief('tone')
  if (funny) {
    const k = r2(WEIGHT_GAIN * funny.c * funny.e)
    tone.comedic = k
  }
  const dark = belief('dark')
  if (dark) {
    const k = r2(WEIGHT_GAIN * dark.c * dark.e)
    tone.dark = k
    tone.warm = r2(-k / 2)
    tone.hopeful = r2(-k / 2)
  }
  if (funny && dark && funny.e < -0.3 && dark.e > 0.3) {
    tone.cynical = r2(WEIGHT_GAIN * Math.min(funny.c, dark.c) * Math.min(-funny.e, dark.e))
  }

  // strand_b: categorical beliefs, confidence-gated so chat and ratings that
  // know better are never overwritten (applyPlayInfluence checks).
  const strandB: Influence['strandB'] = {}
  const complex = belief('complex')
  if (complex) {
    strandB.narrative_complexity = {
      value: complex.e > 0.5 ? 'high' : complex.e > 0.15 ? 'medium_high' : complex.e < -0.3 ? 'low' : 'medium',
      confidence: r2(STRAND_B_GAIN * complex.c),
    }
  }
  if (dark) {
    strandB.moral_ambiguity = {
      value: dark.e > 0.5 ? 'high' : dark.e > 0.15 ? 'medium_high' : dark.e < -0.3 ? 'low' : 'medium',
      confidence: r2(STRAND_B_GAIN * dark.c),
    }
  }
  if (funny && funny.e > 0.3) {
    const humor = belief('humor')
    strandB.humor_style = {
      value: dark && dark.e > 0.4 ? 'dark'
        : humor && humor.e > 0.2 ? 'dry'
        : humor && humor.e < -0.2 ? 'slapstick'
        : 'observational_character_driven',
      confidence: r2(STRAND_B_GAIN * funny.c),
    }
  }
  const indie = belief('indie')
  if (indie) {
    strandB.originality_weight = { value: r2(0.5 + indie.e / 2), confidence: r2(STRAND_B_GAIN * indie.c) }
  }

  return { genres, languages, never: nevers(S), pacing, tone, strandB, creators: trustedCreators(S) }
}

const r2 = (x: number) => Math.round(x * 1000) / 1000

// ── Retract-then-apply ───────────────────────────────────────────────────

type AffinityMap = Record<string, ContentAffinityEntry | CrewAffinityEntry>

/**
 * Add `n` samples at level `delta` to a running average, the same arithmetic
 * as update-content-affinity.ts / update-crew.ts, and say what was applied
 * so it can be taken back out later.
 */
function addSamples(map: AffinityMap, key: string, delta: number, n: number, make: () => AffinityMap[string]): Applied {
  const e = map[key]
  if (!e) {
    const fresh = make()
    fresh.score = clamp(delta, -1, 1)
    fresh.confidence = FIRST_CONFIDENCE
    fresh.sample_size = n
    map[key] = fresh
    return { delta, n, conf: FIRST_CONFIDENCE }
  }
  const confApplied = clamp(e.confidence + n * confidenceDelta(e.score, delta), 0, 1) - e.confidence
  e.score = clamp((e.score * e.sample_size + delta * n) / (e.sample_size + n), -1, 1)
  e.sample_size += n
  e.confidence = clamp(e.confidence + confApplied, 0, 1)
  return { delta, n, conf: confApplied }
}

/**
 * Inverse of addSamples: exact for the score and the sample count; the
 * confidence comes down by the amount recorded, which is exact unless a
 * later writer clamped it at 0 or 1 in between.
 */
function removeSamples(map: AffinityMap, key: string, a: Applied): void {
  const e = map[key]
  if (!e) return
  if (e.sample_size - a.n <= 0) { delete map[key]; return }
  e.score = clamp((e.score * e.sample_size - a.delta * a.n) / (e.sample_size - a.n), -1, 1)
  e.sample_size -= a.n
  e.confidence = clamp(e.confidence - a.conf, 0, 1)
}

type CrewBucket = 'directors' | 'writers' | 'cinematographers' | 'actors'

export interface ResolvedCreator { name: string; bucket: CrewBucket; tmdb_person_id: string }

/**
 * Take the previous sync's contribution out of the DNA and put this one in.
 * Pure over the DNA object; returns the new marker. Safe to re-run against a
 * fresh row (withDNAUpdate replays it on a compare-and-set miss).
 */
export function applyPlayInfluence(
  dna: DNASchema,
  prev: PlayDnaMarker | null,
  inf: Influence,
  creators: ResolvedCreator[],
  state: Pick<PlayState, 'sel' | 'block' | 'round' | 'skipped'> & { done: boolean },
): PlayDnaMarker {
  const c = dna.strand_c_visceral_specs
  const b = dna.strand_b_narrative_dimensions
  const a = dna.strand_a_creative_affinity
  const logic = dna.contextual_logic

  // ── retract ──
  // Weights: subtracting the stored delta is exact unless a later writer
  // clamped the tag at 0 or 1 in between; recentring absorbs the residue.
  if (prev) {
    const ga = (c.genre_affinity ??= {}), la = (c.language_affinity ??= {})
    for (const [k, ap] of Object.entries(prev.genres)) removeSamples(ga, k, ap)
    for (const [k, ap] of Object.entries(prev.languages)) removeSamples(la, k, ap)
    const owned = new Set(prev.rules)
    logic.exclusion_rules = logic.exclusion_rules.filter(r => !owned.has(r.id))
    for (const [k, d] of Object.entries(prev.pacing)) c.pacing_weights[k as keyof StrandC['pacing_weights']] = clamp(c.pacing_weights[k as keyof StrandC['pacing_weights']] - d, 0, 1)
    for (const [k, d] of Object.entries(prev.tone)) c.tone_weights[k as keyof StrandC['tone_weights']] = clamp(c.tone_weights[k as keyof StrandC['tone_weights']] - d, 0, 1)
    for (const [dim, rec] of Object.entries(prev.strandB) as [keyof StrandB, NonNullable<PlayDnaMarker['strandB'][keyof StrandB]>][]) {
      // Only if nothing else has moved it since — otherwise their value stands.
      if (b[dim].value === rec.set.value && b[dim].confidence === rec.set.confidence) {
        b[dim].value = rec.prior.value
        b[dim].confidence = rec.prior.confidence
      }
    }
    for (const [k, ap] of Object.entries(prev.crew)) {
      const [bucket, id] = k.split(':') as [CrewBucket, string]
      removeSamples(a[bucket], id, ap)
      // The boost follows the score; an entry that survived the retraction
      // (ratings added to it) must not keep a boost its score no longer earns.
      const left = a[bucket][id]
      if (left) left.lineage_boost = lineageBoost(left.score)
    }
  }

  // ── apply ──
  const next: PlayDnaMarker = {
    v: 1,
    sel: state.sel ? [...state.sel] : null, block: state.block, round: state.round, done: state.done, skipped: !!state.skipped,
    genres: {}, languages: {}, rules: [], pacing: {}, tone: {}, strandB: {}, crew: {},
  }
  const ga = (c.genre_affinity ??= {}), la = (c.language_affinity ??= {})
  const mk = (): ContentAffinityEntry => ({ score: 0, confidence: 0, sample_size: 0 })
  for (const [k, d] of Object.entries(inf.genres)) next.genres[k] = addSamples(ga, k, d, GENRE_SAMPLES, mk)
  for (const [k, d] of Object.entries(inf.languages)) next.languages[k] = addSamples(la, k, d, GENRE_SAMPLES, mk)

  for (const g of inf.never) {
    for (const name of NEVER_RULE_NAMES[g]) {
      const id = `play:never:${name}`
      const rule: ExclusionRule = { type: 'genre', id, name, raw: `Never: ${name}`, reason: 'Marked "Never" in the taste games' }
      // A rule chat already made for the same genre stands; ours is not
      // added beside it (the reranker would read "NEVER wants: horror, horror").
      if (logic.exclusion_rules.some(r => ruleKey(r) === ruleKey(rule))) continue
      logic.exclusion_rules.push(rule)
      next.rules.push(id)
    }
  }

  for (const [k, d] of Object.entries(inf.pacing) as [keyof StrandC['pacing_weights'], number][]) {
    c.pacing_weights[k] = clamp(c.pacing_weights[k] + d, 0, 1)
    next.pacing[k] = d
  }
  for (const [k, d] of Object.entries(inf.tone) as [keyof StrandC['tone_weights'], number][]) {
    c.tone_weights[k] = clamp(c.tone_weights[k] + d, 0, 1)
    next.tone[k] = d
  }
  if (Object.keys(inf.pacing).length || prev?.pacing && Object.keys(prev.pacing).length) recenterWeights(c.pacing_weights)
  if (Object.keys(inf.tone).length || prev?.tone && Object.keys(prev.tone).length) recenterWeights(c.tone_weights)

  for (const [dim, want] of Object.entries(inf.strandB) as [keyof StrandB, { value: StrandB[keyof StrandB]['value']; confidence: number }][]) {
    // Chat or ratings that are at least as sure as the games keep their value.
    if (b[dim].confidence >= want.confidence) continue
    next.strandB[dim] = { prior: { value: b[dim].value, confidence: b[dim].confidence }, set: { ...want } }
    b[dim].value = want.value
    b[dim].confidence = want.confidence
  }

  for (const cr of creators) {
    const key = `${cr.bucket}:${cr.tmdb_person_id}`
    const mkCrew = (): CrewAffinityEntry => ({ name: cr.name, score: 0, confidence: 0, sample_size: 0, lineage_boost: 'none' })
    const ap = addSamples(a[cr.bucket], cr.tmdb_person_id, CREW_DELTA, CREW_SAMPLES, mkCrew)
    a[cr.bucket][cr.tmdb_person_id].lineage_boost = lineageBoost(a[cr.bucket][cr.tmdb_person_id].score)
    next.crew[key] = { ...ap, name: cr.name }
  }

  return next
}

// ── When to sync ─────────────────────────────────────────────────────────

/** Picks between syncs once the season is over (the games phase has no blocks). */
const ROUNDS_BETWEEN_SYNCS = 6

export function needsSync(S: PlayState, prev: PlayDnaMarker | null): boolean {
  if (!S.sel) return false
  if (!prev) return true
  const done = seasonDone(S)
  return (
    prev.sel?.join() !== S.sel.join() ||
    prev.block !== S.block ||
    prev.done !== done ||
    prev.skipped !== !!S.skipped ||
    S.round < prev.round ||                             // a restart reset it
    S.round - prev.round >= ROUNDS_BETWEEN_SYNCS
  )
}

// ── The sync ─────────────────────────────────────────────────────────────

/**
 * Trusted creator names → TMDB person ids, through the catalog's crew of the
 * game titles that carry the name. Directors first; a series creator is
 * usually credited as a writer. Unresolvable names are skipped.
 */
export async function resolveCreators(names: string[], used: string[], titles: GameTitle[]): Promise<ResolvedCreator[]> {
  if (names.length === 0) return []
  const usedSet = new Set(used)
  const wanted = new Map<string, string[]>()   // name → game title ids
  for (const t of titles) {
    if (!usedSet.has(t.id)) continue
    for (const n of t.creators) if (names.includes(n)) wanted.set(n, [...(wanted.get(n) ?? []), t.id])
  }
  const ids = [...new Set([...wanted.values()].flat())]
  const rows = await fetchTitleCrew(ids.map(id => id.split(':')[1]))
  const out: ResolvedCreator[] = []
  for (const [name, titleIds] of wanted) {
    let found: ResolvedCreator | null = null
    for (const id of titleIds) {
      const row = rows.get(id)
      if (!row) continue
      const crew = row.crew
      const hit =
        crew.directors?.find(p => p.name === name) ? 'directors' :
        crew.writers?.find(p => p.name === name) ? 'writers' :
        crew.cinematographers?.find(p => p.name === name) ? 'cinematographers' :
        crew.cast?.find(p => p.name === name) ? 'actors' : null
      if (!hit) continue
      const pool = hit === 'actors' ? crew.cast : crew[hit]
      const person = pool.find(p => p.name === name)!
      found = { name, bucket: hit, tmdb_person_id: person.tmdb_person_id }
      break
    }
    if (found) out.push(found)
  }
  return out
}

export type PlaySyncOutcome = 'synced' | 'not_due' | 'missing' | 'conflict'

/**
 * Fold the play state into the user's DNA if a milestone has passed since the
 * last sync. The "is it due" check runs inside the compare-and-set, against
 * the marker the row actually holds, so a concurrent sync that landed first
 * makes this one `not_due` on its retry instead of a second retraction.
 */
export async function syncPlayToDNA(userId: string, S: PlayState, titles: GameTitle[]): Promise<PlaySyncOutcome> {
  const inf = playInfluence(S)
  // A failed catalog lookup aborts the sync rather than writing a marker
  // without the creators: the marker would then say "not due" for this
  // state and the trusted creators would wait for the next milestone. Left
  // unwritten, the next save simply retries.
  const creators = await resolveCreators(inf.creators, S.used, titles)
  const dropped = inf.creators.filter(n => !creators.some(c => c.name === n))
  if (dropped.length) console.log(`[play-sync] trusted creator(s) not in the catalog crew, skipped: ${dropped.join(', ')}`)
  const snapshot = { sel: S.sel, block: S.block, round: S.round, skipped: S.skipped, done: seasonDone(S) }

  // Filled by the mutate below (re-run on a compare-and-set miss, so the
  // last run's values are the ones that were saved).
  const result: { dna?: DNASchema } = {}
  const outcome = await withDNAUpdate(userId, dna => {
    const prev = readMarker(dna)
    if (!needsSync(S, prev)) return false
    const marker = applyPlayInfluence(dna, prev, inf, creators, snapshot)
    dna.metadata.play_sync = marker as unknown as Record<string, unknown>
    bumpVersion(dna)
    result.dna = dna
    return true
  }, 3)
  if (outcome === 'unchanged') return 'not_due'
  if (outcome !== 'saved' || !result.dna) return outcome === 'missing' ? 'missing' : 'conflict'

  // The narrative pool reads the embedding by taste_version; best-effort,
  // the row's text hash skips the Mistral call when nothing moved.
  await regenerateEmbedding(userId, result.dna).catch(err =>
    console.warn('[play-sync] embedding regen failed:', err instanceof Error ? err.message : err))
  return 'synced'
}
