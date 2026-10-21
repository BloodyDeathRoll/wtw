import { describe, it, expect } from 'vitest'
import {
  applyPlayInfluence,
  genreDelta,
  isSyncableState,
  needsSync,
  playInfluence,
  readMarker,
  type PlayDnaMarker,
  type ResolvedCreator,
} from '@/modules/dna/update-from-play'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { freshState, type PlayState } from '@/app/play/lib/brain'
import { MIN_CONTENT_SAMPLES } from '@/modules/dna/lib/update-content-affinity'
import { lineageBoost } from '@/modules/dna/lib/reaction-score'

// Slice 2 (2026-10-21): what "Behind the curtain" shows is what the DNA
// registers — scale beliefs, genre chips, trusted creators — as a SET done
// as retract-then-apply, so ratings and chat writing the same fields in
// between are never touched.

/** A state with beliefs: evidence weight `w` at estimate `e` on a scale. */
function believe(S: PlayState, scale: keyof PlayState['sw'], e: number, w = 8) {
  S.sw[scale] = w
  S.sv[scale] = e * w
}

function setup(): PlayState {
  const S = freshState()
  S.sel = ['comedy', 'action', 'scifi']
  S.loved = ['comedy']
  S.gen.comedy = 2
  S.gen.action = 1
  S.gen.scifi = 1
  S.gen.horror = -9
  S.gen.anime = -9
  return S
}

const snap = (S: PlayState) => ({ sel: S.sel, block: S.block, round: S.round, skipped: S.skipped, done: false })

describe('genreDelta', () => {
  it('maps the chip value to a reaction level, and leaves meh and Never alone', () => {
    expect(genreDelta(2)).toBeCloseTo(0.30)        // love = always loved
    expect(genreDelta(1)).toBeCloseTo(0.15)        // like = always liked
    expect(genreDelta(2.6)).toBeCloseTo(0.30)      // drift above love caps
    expect(genreDelta(3)).toBeCloseTo(0.30)
    expect(genreDelta(-1)).toBeCloseTo(-0.10)
    expect(genreDelta(-3)).toBeCloseTo(-0.20)      // caps at always disliked
    expect(genreDelta(-4)).toBeCloseTo(-0.20)
    expect(genreDelta(0.3)).toBeNull()
    expect(genreDelta(-9)).toBeNull()              // Never is a rule, not an affinity
  })
})

describe('playInfluence', () => {
  it('reads the genre chips into catalog genre names, anime love into Japanese', () => {
    const S = setup()
    S.gen.anime = 2
    const inf = playInfluence(S)
    expect(inf.genres.comedy).toBeCloseTo(0.30)
    expect(inf.genres.action).toBeCloseTo(0.15)
    expect(inf.genres['action & adventure']).toBeCloseTo(0.15)
    expect(inf.genres['science fiction']).toBeCloseTo(0.15)
    expect(inf.genres.animation).toBeCloseTo(0.30)
    expect(inf.languages.ja).toBeCloseTo(0.30)
    expect(inf.never).toEqual(['horror'])
  })

  it('writes nothing from a scale it is not yet sure about', () => {
    const S = setup()
    believe(S, 'pace', 0.8, 1)      // one pick's worth: conf ≈ 0.17
    const inf = playInfluence(S)
    expect(inf.pacing).toEqual({})
    expect(inf.strandB).toEqual({})
  })

  it('turns confident beliefs into weight pushes and strand B values', () => {
    const S = setup()
    believe(S, 'pace', 0.8)
    believe(S, 'energy', 0.6)
    believe(S, 'tone', 0.7)
    believe(S, 'dark', -0.6)
    believe(S, 'complex', 0.6)
    believe(S, 'indie', -0.5)
    const inf = playInfluence(S)
    expect(inf.pacing.high_octane).toBeGreaterThan(0.1)
    expect(inf.pacing.slow_burn).toBeCloseTo(-inf.pacing.high_octane!)
    expect(inf.tone.comedic).toBeGreaterThan(0.1)
    expect(inf.tone.dark).toBeLessThan(0)
    expect(inf.tone.warm).toBeGreaterThan(0)
    expect(inf.strandB.narrative_complexity?.value).toBe('high')
    expect(inf.strandB.moral_ambiguity?.value).toBe('low')
    expect(inf.strandB.humor_style?.value).toBe('observational_character_driven')
    expect(inf.strandB.originality_weight?.value).toBeCloseTo(0.25)
    expect(inf.tone.cynical).toBeUndefined()
  })

  it('reads a serious, dark lean as cynical', () => {
    const S = setup()
    believe(S, 'tone', -0.7)
    believe(S, 'dark', 0.7)
    const inf = playInfluence(S)
    expect(inf.tone.cynical).toBeGreaterThan(0)
    expect(inf.strandB.humor_style).toBeUndefined()
  })

  it('names no trusted creator until the brain reads the player', () => {
    const S = setup()
    S.crew = { 'Christopher Nolan': 4 }
    S.crewSeen = { 'Christopher Nolan': 4 }
    expect(playInfluence(S).creators).toEqual([])
    S.preds = Array(20).fill(1)
    expect(playInfluence(S).creators).toEqual(['Christopher Nolan'])
  })
})

describe('applyPlayInfluence', () => {
  it('registers genres with enough samples for the scorer, and Never as a rule', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    const marker = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    const g = dna.strand_c_visceral_specs.genre_affinity!
    expect(g.comedy.score).toBeCloseTo(0.30)
    expect(g.comedy.sample_size).toBe(MIN_CONTENT_SAMPLES)
    expect(g.action.score).toBeCloseTo(0.15)
    const rules = dna.contextual_logic.exclusion_rules
    expect(rules.map(r => r.id)).toEqual(['play:never:horror', 'play:never:anime'])
    expect(rules[0]).toMatchObject({ type: 'genre', name: 'horror' })
    expect(marker.rules).toEqual(['play:never:horror', 'play:never:anime'])
    expect(marker.genres.comedy).toMatchObject({ n: MIN_CONTENT_SAMPLES })
  })

  it('a second sync replaces the first: nothing doubles, a dropped Never is lifted', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    // Restart with other genres: comedy gone, horror now loved.
    S.sel = ['horror', 'drama']
    S.gen.comedy = 0; S.gen.action = 0; S.gen.scifi = 0
    S.gen.horror = 2; S.gen.drama = 1
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    const g = dna.strand_c_visceral_specs.genre_affinity!
    expect(g.comedy).toBeUndefined()
    expect(g.action).toBeUndefined()
    expect(g.horror.score).toBeCloseTo(0.30)
    expect(g.horror.sample_size).toBe(MIN_CONTENT_SAMPLES)
    expect(dna.contextual_logic.exclusion_rules.map(r => r.id)).toEqual(['play:never:anime'])
  })

  it('a rating that landed between syncs on a genre only the games had set survives the retraction', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    const g = dna.strand_c_visceral_specs.genre_affinity!
    // One liked comedy rated in the app (the ratings writer's own arithmetic).
    g.comedy = { score: (0.30 * 3 + 0.15) / 4, confidence: 0.15 + 0.08, sample_size: 4 }
    // Comedy leaves the games' chips entirely.
    S.gen.comedy = 0
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    expect(g.comedy.sample_size).toBe(1)
    expect(g.comedy.score).toBeCloseTo(0.15)
    expect(g.comedy.confidence).toBeCloseTo(0.08)
  })

  it('does not add a Never rule beside one chat already made for the genre', () => {
    const dna = createBlankDNA('u1')
    dna.contextual_logic.exclusion_rules.push({ type: 'genre', id: 'chat-1', name: 'Horror', raw: 'no horror', reason: 'said so' })
    const S = setup()
    const m = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    expect(dna.contextual_logic.exclusion_rules.map(r => r.id)).toEqual(['chat-1', 'play:never:anime'])
    expect(m.rules).toEqual(['play:never:anime'])
  })

  it('leaves what ratings added to the same genre in between', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    // Two loved comedies rated in the app since (the ratings writer's arithmetic).
    const g = dna.strand_c_visceral_specs.genre_affinity!
    g.comedy = { score: (0.30 * 3 + 0.30 * 2) / 5, confidence: 0.31, sample_size: 5 }
    // Comedy drifts down in the games to a like.
    S.gen.comedy = 1
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    expect(g.comedy.sample_size).toBe(5)
    expect(g.comedy.score).toBeCloseTo((0.30 * 2 + 0.15 * 3) / 5)
  })

  it('moves the weight groups and keeps them centred; retracting restores the spread', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    believe(S, 'pace', 0.9)
    believe(S, 'energy', 0.9)
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    const w = dna.strand_c_visceral_specs.pacing_weights
    expect(w.high_octane).toBeGreaterThan(w.slow_burn)
    const mean = (w.slow_burn + w.moderate + w.high_octane) / 3
    expect(mean).toBeCloseTo(0.5, 1)
    // The player changes their mind completely.
    believe(S, 'pace', -0.9)
    believe(S, 'energy', -0.9)
    const m2 = applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    expect(w.slow_burn).toBeGreaterThan(w.high_octane)
    // And a belief that vanishes puts the group back where it was.
    S.sw.pace = 0; S.sv.pace = 0; S.sw.energy = 0; S.sv.energy = 0
    const m3 = applyPlayInfluence(dna, m2, playInfluence(S), [], snap(S))
    expect(m3.pacing).toEqual({})
    // The blank spread (slow = high, moderate a hair above), recentred on 0.5
    // like every other writer leaves it.
    expect(w.high_octane).toBeCloseTo(w.slow_burn, 3)
    expect(w.moderate).toBeGreaterThanOrEqual(w.high_octane)
    expect((w.slow_burn + w.moderate + w.high_octane) / 3).toBeCloseTo(0.5, 1)
  })

  it('never overwrites a strand B value something at least as sure has set', () => {
    const dna = createBlankDNA('u1')
    dna.strand_b_narrative_dimensions.narrative_complexity = { value: 'low', confidence: 0.9, notes: 'said so in chat' }
    const S = setup()
    believe(S, 'complex', 0.8)
    const m = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    expect(dna.strand_b_narrative_dimensions.narrative_complexity.value).toBe('low')
    expect(m.strandB.narrative_complexity).toBeUndefined()
    // A tie goes to what was there.
    const want = playInfluence(S).strandB.narrative_complexity!.confidence
    dna.strand_b_narrative_dimensions.narrative_complexity = { value: 'low', confidence: want, notes: '' }
    applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    expect(dna.strand_b_narrative_dimensions.narrative_complexity.value).toBe('low')
  })

  it('a weight already at the ceiling: retracting is inexact there, and recentring absorbs it', () => {
    const dna = createBlankDNA('u1')
    const w = dna.strand_c_visceral_specs.tone_weights
    w.comedic = 1   // a long run of loved comedies, clamped by the ratings writer
    const S = setup()
    believe(S, 'tone', 0.9)
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    expect(m1.tone.comedic).toBeGreaterThan(0)
    S.sw.tone = 0; S.sv.tone = 0
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    // Still the top tone, and the group is still centred — the residue went
    // into the shared shift, not into the order.
    expect(w.comedic).toBe(Math.max(...Object.values(w)))
    expect(Object.values(w).reduce((s, x) => s + x, 0) / 5).toBeCloseTo(0.5, 1)
  })

  it('a trusted creator ratings also loved keeps a boost its score still earns, and no more', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    const nolan: ResolvedCreator = { name: 'Christopher Nolan', bucket: 'directors', tmdb_person_id: '525' }
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [nolan], snap(S))
    const e = dna.strand_a_creative_affinity.directors['525']
    // Three loved Nolan films rated in the app since (the crew writer's arithmetic).
    e.score = (0.20 * 2 + 0.30 * 3) / 5; e.sample_size = 5; e.confidence = 0.4; e.lineage_boost = 'high'
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    expect(e.sample_size).toBe(3)
    expect(e.score).toBeCloseTo(0.30)
    expect(e.lineage_boost).toBe(lineageBoost(e.score))
  })

  it('sets a strand B value over the blank default, and gives it back when the belief goes', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    believe(S, 'complex', 0.8)
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    const dim = dna.strand_b_narrative_dimensions.narrative_complexity
    expect(dim.value).toBe('high')
    expect(dim.confidence).toBeGreaterThan(0)
    expect(dim.notes).toBe('')
    S.sw.complex = 0; S.sv.complex = 0
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    expect(dim.value).toBe('medium')
    expect(dim.confidence).toBe(0)
  })

  it('registers a trusted creator in strand A by person id', () => {
    const dna = createBlankDNA('u1')
    const S = setup()
    const nolan: ResolvedCreator = { name: 'Christopher Nolan', bucket: 'directors', tmdb_person_id: '525' }
    const m1 = applyPlayInfluence(dna, null, playInfluence(S), [nolan], snap(S))
    const e = dna.strand_a_creative_affinity.directors['525']
    expect(e).toMatchObject({ name: 'Christopher Nolan', sample_size: 2 })
    expect(e.score).toBeCloseTo(0.20)
    expect(m1.crew['directors:525']).toMatchObject({ n: 2, name: 'Christopher Nolan' })
    applyPlayInfluence(dna, m1, playInfluence(S), [], snap(S))
    expect(dna.strand_a_creative_affinity.directors['525']).toBeUndefined()
  })
})

describe('needsSync', () => {
  it('waits for the genres, then fires on milestones only', () => {
    const S = freshState()
    expect(needsSync(S, null)).toBe(false)
    S.sel = ['comedy']
    expect(needsSync(S, null)).toBe(true)
    const marker: PlayDnaMarker = {
      v: 1, sel: ['comedy'], block: 1, round: 0, done: false, skipped: false,
      genres: {}, languages: {}, rules: [], pacing: {}, tone: {}, strandB: {}, crew: {},
    }
    expect(needsSync(S, marker)).toBe(false)
    S.round = 3
    expect(needsSync(S, marker)).toBe(false)          // mid-block picks wait
    S.block = 2
    expect(needsSync(S, marker)).toBe(true)           // block done
    S.block = 1
    S.skipped = true
    expect(needsSync(S, marker)).toBe(true)           // Skip
    S.skipped = false
    S.round = 6
    expect(needsSync(S, marker)).toBe(true)           // games phase: every few picks
    S.round = 0
    S.sel = ['drama']
    expect(needsSync(S, marker)).toBe(true)           // genres changed
    S.sel = ['comedy']
    S.round = 2
    expect(needsSync(S, { ...marker, round: 5 })).toBe(true)   // round went backwards: a restart
  })
})

describe('readMarker / isSyncableState', () => {
  it('reads back only a marker this code wrote', () => {
    const dna = createBlankDNA('u1')
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { v: 1, genres: 'nope' }
    expect(readMarker(dna)).toBeNull()
    const S = setup()
    const m = applyPlayInfluence(dna, null, playInfluence(S), [], snap(S))
    dna.metadata.play_sync = m as unknown as Record<string, unknown>
    expect(readMarker(dna)).toEqual(m)
    // A corrupt number anywhere the retraction would subtract → no marker, nothing retracted.
    dna.metadata.play_sync = { ...m, genres: { ...m.genres, comedy: { delta: NaN, n: 3, conf: 0.15 } } } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { ...m, crew: { 'nope:525': { delta: 0.2, n: 2, conf: 0.15, name: 'x' } } } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { ...m, pacing: { high_octane: 'up' } } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { ...m, tone: { gritty: 0.1 } } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { ...m, strandB: { vibe: { prior: { value: 'x', confidence: 0 }, set: { value: 'y', confidence: 0.3 } } } } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { ...m, sel: 'comedy' } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
    dna.metadata.play_sync = { ...m, crew: { 'directors:not-an-id': { delta: 0.2, n: 2, conf: 0.15, name: 'x' } } } as unknown as Record<string, unknown>
    expect(readMarker(dna)).toBeNull()
  })

  it('accepts a real play state and refuses a malformed one', () => {
    expect(isSyncableState(setup())).toBe(true)
    expect(isSyncableState(null)).toBe(false)
    expect(isSyncableState({ ...setup(), gen: { comedy: 'two' } })).toBe(false)
    expect(isSyncableState({ ...setup(), sel: 'comedy' })).toBe(false)
    expect(isSyncableState({ ...setup(), used: [1, 2] })).toBe(false)
    expect(isSyncableState({ ...setup(), v: 2 })).toBe(false)
  })
})
