import { describe, it, expect } from 'vitest'
import { servedFormula, concordance, userLiveScores, servedShares, type ReactionRow, type ServedRow } from '@/modules/engine/live-score'

// PLAN §6 "live score": per user, concordance between the score a feed card was
// served with and the reaction it then got, per formula.

const payload = (taste?: object) => ({ crew_matches: [], ...(taste ? { taste } : {}) }) as never

describe('servedFormula', () => {
  it('v2 batches carry the taste field; v1 ones don\'t; a 0 score is a cold-start pick', () => {
    expect(servedFormula({ composite_score: 0.9, reason_payload: payload({ like: [] }) })).toBe('v2')
    expect(servedFormula({ composite_score: 0.6, reason_payload: payload() })).toBe('v1')
    expect(servedFormula({ composite_score: 0, reason_payload: payload({ like: [] }) })).toBe('cold')
  })
})

describe('concordance', () => {
  it('100 when every preferred title scores higher, 0 when every one scores lower, ties half', () => {
    const good = [{ score: 0.9, level: 'loved' as const }, { score: 0.5, level: 'liked' as const }, { score: 0.1, level: 'disliked' as const }]
    expect(concordance(good)).toBe(100)
    expect(concordance(good.map(x => ({ ...x, score: -x.score })))).toBe(0)
    expect(concordance([{ score: 1, level: 'loved' }, { score: 1, level: 'disliked' }])).toBe(50)
  })
  it('L/D keeps loved-vs-disliked pairs only', () => {
    const items = [{ score: 0.9, level: 'loved' as const }, { score: 0.95, level: 'liked' as const }, { score: 0.1, level: 'disliked' as const }]
    expect(concordance(items, true)).toBe(100)
    expect(concordance(items)).toBeCloseTo(200 / 3, 6)
  })
  it('NaN with no pairs', () => {
    expect(concordance([{ score: 1, level: 'loved' }])).toBeNaN()
  })
})

describe('userLiveScores', () => {
  const served = (key: string, score: number | null, formula: string | null, at = '2026-11-10T00:00:00Z'): ServedRow => ({ key, score, formula, first_served_at: at })
  const react = (key: string, level: ReactionRow['level'], at = '2026-11-11T00:00:00Z'): ReactionRow => ({ key, level, at })

  it('scores each formula separately and counts the split', () => {
    const s = [served('movie:1', 0.9, 'v2'), served('movie:2', 0.2, 'v2'), served('movie:3', 0.7, 'v1'), served('movie:4', 0.3, 'v1')]
    const r = [react('movie:1', 'loved'), react('movie:2', 'disliked'), react('movie:3', 'disliked'), react('movie:4', 'loved')]
    expect(userLiveScores(s, r, 2)).toEqual([
      { formula: 'v1', n: 2, loved: 1, liked: 0, disliked: 1, concordance: 0, ld: 0 },
      { formula: 'v2', n: 2, loved: 1, liked: 0, disliked: 1, concordance: 100, ld: 100 },
    ])
  })

  it('ignores a reaction that came before the card was ever served', () => {
    const s = [served('movie:1', 0.9, 'v2', '2026-11-12T00:00:00Z'), served('movie:2', 0.2, 'v2')]
    const r = [react('movie:1', 'loved', '2026-11-11T00:00:00Z'), react('movie:2', 'disliked')]
    expect(userLiveScores(s, r, 1)[0].n).toBe(1)
  })

  it('takes the latest reaction for a title', () => {
    const s = [served('movie:1', 0.9, 'v2'), served('movie:2', 0.2, 'v2')]
    const r = [react('movie:1', 'disliked', '2026-11-11T00:00:00Z'), react('movie:1', 'loved', '2026-11-12T00:00:00Z'), react('movie:2', 'disliked')]
    expect(userLiveScores(s, r, 1)[0]).toMatchObject({ loved: 1, disliked: 1, concordance: 100 })
  })

  it('leaves out cold-start cards, unscored rows, and users under the minimum', () => {
    const s = [served('movie:1', 0, 'cold'), served('movie:2', null, null), served('movie:3', 0.5, 'v2')]
    const r = [react('movie:1', 'loved'), react('movie:2', 'loved'), react('movie:3', 'liked')]
    expect(userLiveScores(s, r, 1)).toEqual([{ formula: 'v2', n: 1, loved: 0, liked: 1, disliked: 0, concordance: NaN, ld: NaN }])
    expect(userLiveScores(s, r, 2)).toEqual([])
  })
})

describe('servedShares', () => {
  const served = (key: string, formula: string | null, at = '2026-11-10T00:00:00Z', score: number | null = 0.5): ServedRow => ({ key, score, formula, first_served_at: at })
  const react = (key: string, level: ReactionRow['level'], at = '2026-11-11T00:00:00Z'): ReactionRow => ({ key, level, at })
  const since = '2026-11-09T00:00:00.000Z'

  it('splits everything served by its reaction, and counts the rest as unknown', () => {
    const s = [served('movie:1', 'v2'), served('movie:2', 'v2'), served('tv:3', 'v2'), served('movie:4', 'v2'), served('movie:5', 'v1')]
    const r = [react('movie:1', 'loved'), react('movie:2', 'disliked'), react('tv:3', 'liked'), react('movie:5', 'loved')]
    expect(servedShares(s, r, since)).toEqual([
      { formula: 'v1', served: 1, loved: 1, liked: 0, disliked: 0, unknown: 0 },
      { formula: 'v2', served: 4, loved: 1, liked: 1, disliked: 1, unknown: 1 },
    ])
  })

  it('a reaction from before the card was served is unknown; the latest reaction wins', () => {
    const s = [served('movie:1', 'v2', '2026-11-12T00:00:00Z'), served('movie:2', 'v2')]
    const r = [react('movie:1', 'loved', '2026-11-11T00:00:00Z'), react('movie:2', 'loved', '2026-11-11T00:00:00Z'), react('movie:2', 'disliked', '2026-11-12T00:00:00Z')]
    expect(servedShares(s, r, since)).toEqual([{ formula: 'v2', served: 2, loved: 0, liked: 0, disliked: 1, unknown: 1 }])
  })

  it('leaves out cards first served before the window, cold-start cards and unscored rows', () => {
    const s = [served('movie:1', 'v2', '2026-11-01T00:00:00Z'), served('movie:2', 'cold', undefined, 0), served('movie:3', null, undefined, null), served('movie:4', 'v2', '2026-11-10T00:00:00.000123+00:00')]
    expect(servedShares(s, [], since)).toEqual([{ formula: 'v2', served: 1, loved: 0, liked: 0, disliked: 0, unknown: 1 }])
  })
})
