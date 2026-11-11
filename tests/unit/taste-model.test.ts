import { describe, it, expect } from 'vitest'

import type { DNASignal } from '@/types/dna'
import { buildTraining, contributions, predict, trainTasteModel, type TastePair, type TasteRow } from '@/modules/dna/taste-model'

/**
 * Reference fixture: 40 titles from a MINSTD generator (exact in both JS and
 * Python), 30 rated (every 5th weighted 0.5), 10 picks. Expected weights from:
 *
 *   import numpy as np
 *   M = 2147483647; x = 42
 *   def u():
 *       global x; x = (48271 * x) % M; return x / M
 *   V = [[u() * 6 - 3] + [u() * 2 - 1 for _ in range(24)] for _ in range(40)]
 *   rows = [(V[i], 1 + int(u() * 3), 0.5 if i % 5 == 0 else 1.0) for i in range(30)]
 *   pairs = [(V[30 + k], V[(7 * k) % 40]) for k in range(10)]
 *   W = np.array([r[2] for r in rows]); L = np.array([r[1] for r in rows], float)
 *   y = L - (W * L).sum() / W.sum()
 *   X = np.vstack([np.array([r[0] for r in rows]), np.array([np.array(c) - np.array(o) for c, o in pairs])])
 *   Y = np.concatenate([y, np.ones(len(pairs))]); Wt = np.concatenate([W, np.ones(len(pairs))])
 *   lam = np.diag([0.5] + [4.0] * 24)
 *   w = np.linalg.solve(X.T @ (Wt[:, None] * X) + lam, X.T @ (Wt * Y))
 */
const EXPECTED = [0.23710913838722575, -0.03617272317238878, -0.03412908800798539, -0.1131998060864687, -0.04544291394589758, -0.023515812806560853, 0.12430031961745878, 0.3793936459755021, -0.1753750096923113, 0.010728759892774437, 0.07919256447652062, 0.18767615925580222, -0.10500857208401478, -0.13725827932761528, 0.017223187863216242, 0.1462781969065317, -0.2456201741917539, 0.06481232112127877, -0.05164979645608253, 0.17625489900556318, 0.4926129871401926, 0.1478133638304314, 0.1564064546140105, 0.29036284782969796, -0.14686007231655898]

function fixture() {
  const M = 2147483647
  let x = 42
  const u = () => { x = (48271 * x) % M; return x / M }
  const V = Array.from({ length: 40 }, () => { const first = u() * 6 - 3; return [first, ...Array.from({ length: 24 }, () => u() * 2 - 1)] })
  const rows: TasteRow[] = Array.from({ length: 30 }, (_, i) => ({ vec: V[i], level: (1 + Math.floor(u() * 3)) as 1 | 2 | 3, weight: i % 5 === 0 ? 0.5 : 1 }))
  const pairs: TastePair[] = Array.from({ length: 10 }, (_, k) => ({ chosen: V[30 + k], other: V[(7 * k) % 40] }))
  return { rows, pairs }
}

const sig = (tmdb_id: string, reaction: DNASignal['reaction'], extra: Partial<DNASignal> = {}): DNASignal => ({
  title: tmdb_id, tmdb_id, type: 'movie', reaction, quick_rating: null, regret_signal: null, source: 'manual', reason: '',
  dimensions_reinforced: [], dimensions_contradicted: [], confidence: 1, flag: null, watched_at: null, ...extra,
})

describe('trainTasteModel', () => {
  it('matches the numpy reference recipe to 1e-6', () => {
    const { rows, pairs } = fixture()
    const w = trainTasteModel(rows, pairs)
    expect(w).toHaveLength(25)
    w.forEach((v, k) => expect(Math.abs(v - EXPECTED[k]), `w[${k}]`).toBeLessThan(1e-6))
  })

  it('returns zeros with no data', () => {
    expect(trainTasteModel([], [])).toEqual(new Array(25).fill(0))
  })
})

describe('predict / contributions', () => {
  it('contributions sum to the prediction', () => {
    const { rows, pairs } = fixture()
    const w = trainTasteModel(rows, pairs)
    const c = contributions(w, rows[0].vec)
    expect(c.reduce((s, v) => s + v, 0)).toBeCloseTo(predict(w, rows[0].vec), 12)
  })
})

describe('buildTraining', () => {
  const vec = (n: number) => new Array(25).fill(n)
  const vecs = new Map([['movie:1', vec(1)], ['movie:2', vec(2)], ['movie:3', vec(3)], ['tv:1', vec(9)]])
  const now = Date.parse('2026-11-11T00:00:00Z')

  it('maps reactions to levels, halves old ratings, drops chat-named and vector-less titles', () => {
    const { rows } = buildTraining([
      sig('1', 'loved'),
      sig('2', 'disliked', { watched_at: '2024-01-01T00:00:00Z' }),
      sig('3', 'liked', { source: 'session_4' }),
      sig('4', 'liked'),
    ], [], vecs, now)
    expect(rows).toEqual([{ vec: vec(1), level: 3, weight: 1 }, { vec: vec(2), level: 1, weight: 0.5 }])
  })

  it('treats a rating exactly 18 months old as recent, and a null watched_at as recent', () => {
    const edge = new Date(now - 18 * 30 * 24 * 60 * 60 * 1000).toISOString()
    const { rows } = buildTraining([sig('1', 'liked', { watched_at: edge }), sig('2', 'liked')], [], vecs, now)
    expect(rows.map(r => r.weight)).toEqual([1, 1])
  })

  it('keys by media type, so a series never borrows a movie\'s vector', () => {
    const { rows } = buildTraining([sig('1', 'liked', { type: 'tv' })], [], vecs, now)
    expect(rows[0].vec).toEqual(vec(9))
  })

  it('turns picks into chosen/other pairs, skipping ones without both vectors', () => {
    const { pairs } = buildTraining([], [
      { a: 'movie:1', b: 'movie:2', chosen: 'movie:2' },
      { a: 'movie:1', b: 'movie:9', chosen: 'movie:1' },
      { a: 'movie:1', b: 'movie:2', chosen: 'movie:3' },
      { a: 'movie:1', b: 'movie:1', chosen: 'movie:1' },
    ], vecs, now)
    expect(pairs).toEqual([{ chosen: vec(2), other: vec(1) }])
  })
})
