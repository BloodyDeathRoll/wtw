import { describe, it, expect } from 'vitest'
import {
  tasteLikes, tasteCatch, tasteBars, whatItsLike, tasteNegatives, BARS_MIN_POOL, sharedCatchKeys, tasteCatchKey,
} from '@/modules/engine/why/taste-facts'
import { normalCdf, type V2Score } from '@/modules/engine/scoring/formula-v2'
import { FEATURE_GENRES, FEATURE_SCALES } from '@/lib/taste-scales/features'

// P1-E5: the Why facts under formula v2 come from the taste model's
// contributions (w_k·x_k) and the title's own vector, said in words.

const G = (g: (typeof FEATURE_GENRES)[number]) => 1 + FEATURE_GENRES.indexOf(g)
const S = (s: (typeof FEATURE_SCALES)[number] | 'audience') => (s === 'audience' ? 24 : 14 + FEATURE_SCALES.indexOf(s))
const at = (entries: [number, number][]) => { const v = new Array(25).fill(0); for (const [i, x] of entries) v[i] = x; return v }

describe('tasteLikes — the two strongest pulls', () => {
  it('two scales read as one sentence, "both"', () => {
    const vec = at([[S('dark'), -0.8], [S('fantastic'), -0.7]])
    const c = at([[S('dark'), 0.3], [S('fantastic'), 0.2]])
    expect(tasteLikes(c, vec)).toEqual(['This viewer goes for light, down-to-earth stories, and this one is both.'])
  })

  it('a genre reads as its own sentence', () => {
    const vec = at([[G('crime'), 0.5], [S('complex'), 0.9]])
    const c = at([[G('crime'), 0.4], [S('complex'), 0.1]])
    expect(tasteLikes(c, vec)).toEqual([
      'This viewer goes for twisty stories, and this one is twisty.',
      'Crime is a genre this viewer goes for.',
    ])
  })

  it('takes the top 2 only, and never the rating input', () => {
    const vec = at([[0, 3], [G('drama'), 1], [S('tone'), 0.9], [S('pace'), 0.9]])
    const c = at([[0, 5], [G('drama'), 0.1], [S('tone'), 0.3], [S('pace'), 0.2]])
    expect(tasteLikes(c, vec)).toEqual(['This viewer goes for funny, fast stories, and this one is both.'])
  })

  it('says a scale only where the title clearly sits at that end', () => {
    const vec = at([[S('dark'), 0.3]]) // a pull, but the title is barely dark
    const c = at([[S('dark'), 0.4]])
    expect(tasteLikes(c, vec)).toEqual([])
  })

  it('a negative or zero pull is never a like', () => {
    expect(tasteLikes(at([[S('dark'), -0.3]]), at([[S('dark'), 0.9]]))).toEqual([])
    expect(tasteLikes(new Array(25).fill(0), new Array(25).fill(0))).toEqual([])
  })
})

describe('tasteCatch — the strongest pull away', () => {
  it('a scale, said as a comparison from the end the title sits at', () => {
    expect(tasteCatch(at([[S('dark'), -0.2]]), at([[S('dark'), 0.7]]))).toBe("It's darker than this viewer usually goes for.")
    expect(tasteCatch(at([[S('indie'), -0.1]]), at([[S('indie'), -0.6]]))).toBe("It's more mainstream than this viewer usually goes for.")
    expect(tasteCatch(at([[S('energy'), -0.1]]), at([[S('energy'), -0.6]]))).toBe("It's talkier than this viewer usually goes for.")
  })

  it('a genre, "partly" when the title has others too', () => {
    expect(tasteCatch(at([[G('horror'), -0.3]]), at([[G('horror'), 0.5], [G('drama'), 0.5]])))
      .toBe("It's partly horror, and horror isn't a genre this viewer usually goes for.")
    expect(tasteCatch(at([[G('horror'), -0.3]]), at([[G('horror'), 1]])))
      .toBe("It's horror, and horror isn't a genre this viewer usually goes for.")
  })

  it('takes the most negative one', () => {
    const c = at([[S('dark'), -0.1], [S('pace'), -0.3]])
    expect(tasteCatch(c, at([[S('dark'), 0.8], [S('pace'), -0.8]]))).toBe("It's slower than this viewer usually goes for.")
  })

  it('nothing at or above −0.05 is a catch, and the rating input never is', () => {
    expect(tasteCatch(at([[S('dark'), -0.05]]), at([[S('dark'), 0.9]]))).toBeNull()
    expect(tasteCatch(at([[0, -2]]), at([[0, -3]]))).toBeNull()
  })
})

const v2 = (o: Partial<V2Score>): V2Score => ({
  z_creators: 0, z_crowd: 0, z_model: 0, model_score: 0, s: 0, composite: 0.5, pool_size: 100, ...o,
})

describe('tasteBars', () => {
  it('each bar is Φ of that part\'s z', () => {
    expect(tasteBars(v2({ z_model: 1, z_crowd: -1, z_creators: 0 }))).toEqual({
      taste: normalCdf(1), crowd: normalCdf(-1), creators: 0.5,
    })
  })

  it(`none for a pool under ${BARS_MIN_POOL}: a z among a handful says nothing`, () => {
    expect(tasteBars(v2({ pool_size: 1 }))).toBeNull()
    expect(tasteBars(v2({ pool_size: BARS_MIN_POOL - 1 }))).toBeNull()
    expect(tasteBars(v2({ pool_size: BARS_MIN_POOL }))).not.toBeNull()
  })
})

describe('whatItsLike', () => {
  it('clear scale ends strongest first, then genres, then language', () => {
    const vec = at([[S('dark'), 0.6], [S('complex'), 0.9], [S('pace'), 0.2], [G('crime'), 0.5], [G('thriller'), 0.5]])
    expect(whatItsLike(vec, 'ko')).toEqual([
      { dimension: 'feel', value: 'twisty, dark' },
      { dimension: 'genre', value: 'crime, thriller & mystery' },
      { dimension: 'language', value: 'ko' },
    ])
  })

  it('leaves out what it has nothing for', () => {
    expect(whatItsLike(new Array(25).fill(0), null)).toEqual([])
  })
})

describe('tasteNegatives — step 6 under v2, in the sheet\'s voice', () => {
  const facts = { vec: at([[S('dark'), 0.8]]), contributions: at([[S('dark'), -0.3]]) }

  it('the model z well below the pool → the catch, said to you', () => {
    expect(tasteNegatives(v2({ z_model: -0.6, model_score: -1, ...facts }))).toEqual(["It's darker than you usually go for."])
  })

  it('the crowd z far below the pool → rated lower than your usual picks', () => {
    expect(tasteNegatives(v2({ z_crowd: -1.2 }))).toEqual(['Rated lower than what you usually pick.'])
  })

  it('nothing when neither is low', () => {
    expect(tasteNegatives(v2({ z_model: -0.4, z_crowd: -0.9, ...facts }))).toEqual([])
  })

  it('a title without a vector has no model reason against it', () => {
    expect(tasteNegatives(v2({ z_model: -0.6, model_score: null }))).toEqual([])
  })
})

describe('sharedCatchKeys — a catch most of the batch shares is not said', () => {
  const batch = (n: number, shared: number, key = '20:0') => [
    ...new Array(shared).fill(key), ...new Array(n - shared).fill(null),
  ]
  it('more than half of the batch → shared', () => {
    expect(sharedCatchKeys(batch(50, 26))).toEqual(new Set(['20:0']))
  })
  it('half or fewer → still said', () => {
    expect(sharedCatchKeys(batch(50, 25)).size).toBe(0)
  })
  it('too small a batch to tell → nothing shared', () => {
    expect(sharedCatchKeys(batch(10, 9)).size).toBe(0)
  })
  it('the key tells the two ends of a scale apart', () => {
    expect(tasteCatchKey(at([[S('indie'), -0.1]]), at([[S('indie'), -0.6]]))).toBe(`${S('indie')}:0`)
    expect(tasteCatchKey(at([[S('indie'), -0.1]]), at([[S('indie'), 0.6]]))).toBe(`${S('indie')}:1`)
    expect(tasteCatchKey(new Array(25).fill(0), new Array(25).fill(0))).toBeNull()
  })
})

describe('tasteNegatives — a shared catch is left out', () => {
  it('drops the model line, keeps the crowd line', () => {
    const facts = { vec: at([[S('dark'), 0.8]]), contributions: at([[S('dark'), -0.3]]) }
    expect(tasteNegatives(v2({ z_model: -0.6, model_score: -1, z_crowd: -1.5, ...facts }), true)).toEqual(['Rated lower than what you usually pick.'])
  })
})
