import { describe, it, expect } from 'vitest'
import { to13, applyGenreStep, canStart } from '@/app/onboarding/lib/genre-step'
import { applyPlayInfluence, needsSync, playInfluence } from '@/modules/dna/update-from-play'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { freshState } from '@/app/play/lib/brain'

// P2-U2: the genre screen's answers (16 genres) → the state the picker reads (13) and exact Nevers in Taste DNA.
describe('Genre step: what the answers do', () => {
  it('needs at least one Love or Like to start; a Never alone does not count', () => {
    expect(canStart({})).toBe(false)
    expect(canStart({ horror: 'never' })).toBe(false)
    expect(canStart({ horror: 'never', comedy: 'like' })).toBe(true)
  })

  it('carries Love / Like over to the 13, the strongest one winning', () => {
    const g = to13({ comedy: 'love', fantasy: 'like', hero: 'love', adultanim: 'like' })
    expect(g).toMatchObject({ comedy: 2, scifi: 2, anim: 1, drama: 0 })
  })

  it('makes a 13-genre a Never only when every one of its 16 is a Never', () => {
    expect(to13({ hero: 'never' }).scifi).toBe(0)                 // "Never: Superheroes" keeps the rest of sci-fi
    expect(to13({ hero: 'never', scifi: 'like' }).scifi).toBe(1)
    expect(to13({ scifi: 'never', fantasy: 'never', hero: 'never' }).scifi).toBe(-9)
    expect(to13({ horror: 'never' }).horror).toBe(-9)
  })

  it('after Start: both lists saved, the step moved on, the season fields set as its own genre step does', () => {
    const S = applyGenreStep(null, { comedy: 'love', crime: 'like', hero: 'never' })
    expect(S.onboarding).toMatchObject({ genres16: { comedy: 'love', crime: 'like', hero: 'never' }, step: 'cards' })
    expect(S.sel).toEqual(['comedy', 'crime'])
    expect(S.loved).toEqual(['comedy'])
  })

  it('writes a Never on the 16 as its exact rule in Taste DNA, and only that', () => {
    const S = applyGenreStep(null, { comedy: 'love', hero: 'never', adultanim: 'never' })
    const dna = createBlankDNA('u1')
    const marker = applyPlayInfluence(dna, null, playInfluence(S), [], { sel: S.sel, block: S.block, round: S.round, skipped: S.skipped, done: false })
    const rules = dna.contextual_logic.exclusion_rules
    expect(rules.map(r => r.name).sort()).toEqual(['Adult animation', 'Superheroes'])
    expect(rules.map(r => r.id).sort()).toEqual(['genre16:never:adultanim', 'genre16:never:hero'])
    expect(marker.rules.sort()).toEqual(['genre16:never:adultanim', 'genre16:never:hero'])
    // Taking a Never back is a change the sync must notice, and the rule goes.
    const S2 = applyGenreStep(S, { comedy: 'love', adultanim: 'never' })
    expect(needsSync(S2, marker)).toBe(true)
    applyPlayInfluence(dna, marker, playInfluence(S2), [], { sel: S2.sel, block: S2.block, round: S2.round, skipped: S2.skipped, done: false })
    expect(dna.contextual_logic.exclusion_rules.map(r => r.name)).toEqual(['Adult animation'])
  })

  it('leaves a season player without the new screen exactly as before', () => {
    const S = freshState()
    S.sel = ['comedy']; S.gen.comedy = 2; S.gen.horror = -9
    expect(playInfluence(S).never16).toEqual([])
  })
})
