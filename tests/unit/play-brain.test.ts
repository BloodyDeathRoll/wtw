import { describe, it, expect } from 'vitest'
import {
  freshState, prepareTitles, nextPair, choose, replaceSide, knowledge, readsYou, accuracy,
  topRecs, predict, settleBet, answerHunch, hunchCandidate, pairKey, est, loveBoth, viewerName,
  trustedCreators, isUnlocked, neither, showdownPair, recScore, type PlayState, type Pair,
} from '@/app/play/lib/brain'
import { blockTypeFor, SEASON, seasonDone } from '@/app/play/lib/blocks'
import { factHeadline, revealOf, revealTier } from '@/app/play/lib/reveal'
import { redact, blindDeck, blindPlot, withBlindPlots, withSideClues, sideClues, otherDeck, titleSearch, markServed, LEVELS } from '@/app/play/lib/games'
import type { GameTitle } from '@/app/play/lib/scales'
import type { GameGenre } from '@/app/play/lib/genres'

// A deterministic stand-in for Math.random.
function seeded(seed = 7) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
}

let n = 0
function title(over: Partial<GameTitle> & { genres: GameGenre[] }): GameTitle {
  n++
  const r = seeded(n)
  const s = () => Math.round((r() * 2 - 1) * 100) / 100
  return {
    id: `${over.type ?? 'movie'}:${n}`, tmdb_id: String(n), type: 'movie', title: `Title ${n}`, year: 2000,
    poster_path: null, overview: 'A plot.', creators: [`Director ${n % 9}`], runtime: 100,
    collection: null, groups: [], trailer_key: null, where: null, characters: [], keywords: [], aliases: [],
    seasons: null, episodes: null, votes: 1000 + n, rating: 7, pop: r(),
    scales: { tone: s(), energy: s(), pace: s(), dark: s(), complex: s(), fantastic: s(), modern: s(), indie: s() },
    never: over.genres,
    ...over,
  } as GameTitle
}

const catalogue = prepareTitles([
  ...Array.from({ length: 30 }, () => title({ genres: ['comedy'] })),
  ...Array.from({ length: 30 }, () => title({ genres: ['horror'] })),
  ...Array.from({ length: 20 }, () => title({ genres: ['drama', 'crime'] })),
  // A comedy series the data can't call horror for sure (e.g. vampire keyword).
  title({ type: 'tv', genres: ['comedy'], never: ['comedy', 'horror'] }),
  ...Array.from({ length: 20 }, () => title({ type: 'tv', genres: ['comedy'], scales: { tone: 0.5, energy: 0, pace: 0, dark: 0, complex: 0, fantastic: 0, modern: 0, indie: 0, commit: 0.2 } })),
])

function setUp(over: Partial<PlayState> = {}): PlayState {
  const S = freshState()
  S.gen.comedy = 2
  S.gen.drama = 1
  S.sel = ['comedy', 'drama']
  return Object.assign(S, over)
}

describe('nextPair', () => {
  it('never shows a "Never" genre, even after widening', () => {
    const S = setUp()
    S.gen.horror = -9
    S.widen = true
    const rand = seeded()
    for (let i = 0; i < 25; i++) {
      const p = nextPair(S, catalogue, {}, rand)
      if (!p) break
      expect(p.a.never).not.toContain('horror')
      expect(p.b.never).not.toContain('horror')
      choose(S, p, 'a')
    }
  })

  it('only pairs movies with movies and series with series', () => {
    const S = setUp()
    const rand = seeded(3)
    for (let i = 0; i < 20; i++) {
      const p = nextPair(S, catalogue, {}, rand)
      if (!p) break
      expect(p.a.type).toBe(p.b.type)
      choose(S, p, 'b')
    }
  })

  it('never repeats the same pair', () => {
    const S = setUp()
    const rand = seeded(5)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const p = nextPair(S, catalogue, {}, rand)
      if (!p) break
      const k = pairKey(p.a, p.b)
      expect(seen.has(k)).toBe(false)
      seen.add(k)
      choose(S, p, 'a')
    }
  })

  it('respects the Movies-only switch', () => {
    const S = setUp({ format: 'movies' })
    const rand = seeded(9)
    for (let i = 0; i < 15; i++) {
      const p = nextPair(S, catalogue, {}, rand)
      if (!p) break
      expect(p.a.type).toBe('movie')
      choose(S, p, 'a')
    }
  })

  it('keeps a bonus round inside its genre', () => {
    const S = setUp()
    const p = nextPair(S, catalogue, { genre: 'drama' }, seeded(2))!
    expect(p.a.genres).toContain('drama')
    expect(p.b.genres).toContain('drama')
  })
})

describe('answers', () => {
  it('a pick moves the estimate toward the chosen title on the tested scale', () => {
    const S = setUp()
    const p = nextPair(S, catalogue, {}, seeded(11))!
    const axis = p.axis as 'tone'
    const winner = (p.a.scales[axis]! > p.b.scales[axis]!) ? 'a' : 'b'
    choose(S, p, winner)
    expect(est(S, axis)).toBeGreaterThan(0)
  })

  it('"Haven\'t seen" twice turns the duel into a plot comparison', () => {
    const S = setUp()
    const p = nextPair(S, catalogue, {}, seeded(13))!
    replaceSide(S, catalogue, p, 'a')
    expect(p.pitch).toBe(false)
    replaceSide(S, catalogue, p, 'b')
    expect(p.pitch).toBe(true)
  })

  it('love both counts as an answer and nudges shared traits', () => {
    const S = setUp()
    const p = nextPair(S, catalogue, {}, seeded(17))!
    loveBoth(S, p)
    expect(S.round).toBe(1)
  })
})

describe('how well WTW knows the player', () => {
  // A player whose taste is real: always takes the funnier, lighter title.
  const consistent = (p: Pair): 'a' | 'b' => {
    const u = (t: Pair['a']) => (t.scales.tone ?? 0) - (t.scales.dark ?? 0)
    return u(p.a) >= u(p.b) ? 'a' : 'b'
  }

  it('starts knowing nothing and claims nothing', () => {
    const S = setUp()
    expect(knowledge(S)).toBe(0)
    expect(readsYou(S)).toBe(false)
    expect(viewerName(S)).toBeNull()
  })

  it('random tapping never counts as knowing someone', () => {
    const S = setUp()
    const rand = seeded(19), coin = seeded(101)
    for (let i = 0; i < 80; i++) { const p = nextPair(S, catalogue, {}, rand); if (p) choose(S, p, coin() < 0.5 ? 'a' : 'b') }
    expect(readsYou(S)).toBe(false)
    expect(viewerName(S)).toBeNull()
    expect(knowledge(S)).toBeLessThan(0.3)
  })

  it('a consistent player gets read', () => {
    const S = setUp()
    const rand = seeded(29)
    for (let i = 0; i < 40; i++) { const p = nextPair(S, catalogue, {}, rand); if (p) choose(S, p, consistent(p)) }
    expect(accuracy(S).rate).toBeGreaterThan(0.6)
    expect(readsYou(S)).toBe(true)
  })

  it('a creator is only "trusted" when their titles keep winning', () => {
    const S = setUp()
    S.crew = { A: 3, B: 3 }
    S.crewSeen = { A: 4, B: 6 }
    expect(trustedCreators(S)).toEqual([])           // not until the brain reads the player
    S.preds = Array(20).fill(1)
    expect(trustedCreators(S)).toEqual(['A'])
  })

  it('never recommends a title the games already showed', () => {
    const S = setUp()
    const rand = seeded(23)
    for (let i = 0; i < 10; i++) { const p = nextPair(S, catalogue, {}, rand); if (p) choose(S, p, 'a') }
    for (const r of topRecs(S, catalogue, 10)) expect(S.used).not.toContain(r.t.id)
  })
})

describe('the season', () => {
  it('follows the agreed 15 steps, then keeps going with sharpen steps', () => {
    expect(SEASON).toEqual(['setup', 'plain', 'knockout', 'plain', 'blind', 'lightning', 'plain', 'other',
      'deepdive', 'plain', 'hilo', 'creators', 'plain', 'showdown', 'finale'])
    const S = setUp()
    expect(blockTypeFor(S, catalogue, 5)).toBe('blind')
    expect(blockTypeFor(S, catalogue, 14)).toBe('showdown')
    expect(blockTypeFor(S, catalogue, 17)).toBe('plain')
    expect(blockTypeFor(S, catalogue, 16)).not.toBe('plain')
  })

  it('picks, The Bet and Mind Reader open with the finale, not before', () => {
    const S = setUp()
    S.block = 15
    expect(isUnlocked(S, 'picks')).toBe(false)
    expect(seasonDone(S)).toBe(false)
    S.block = 16
    expect(isUnlocked(S, 'picks')).toBe(true)
    expect(isUnlocked(S, 'bet')).toBe(true)
    expect(isUnlocked(S, 'mind')).toBe(true)
    expect(seasonDone(S)).toBe(true)
  })
})

describe('season games', () => {
  const t = (over: Partial<GameTitle>) => prepareTitles([title({ genres: ['drama'], ...over } as never)])[0]

  it('blacks out character names and title words, keeps the rest of the real plot', () => {
    const x = t({ title: 'The Shawshank Redemption', characters: ['Andy Dufresne', "Ellis Boyd 'Red' Redding"], aliases: [], keywords: [],
      overview: 'Banker Andy Dufresne is sent to Shawshank prison, where he befriends Red.' })
    const r = redact(x)
    expect(r).not.toMatch(/Andy|Dufresne|Shawshank|Red\b/)
    expect(r).toContain('is sent to')
    expect(r).toContain('prison')
  })

  it('also blacks out a series name the hero is known by (Batman for The Dark Knight)', () => {
    const x = t({ title: 'The Dark Knight', characters: ['Bruce Wayne'], aliases: ['Batman', 'Begins'], keywords: [],
      overview: 'Batman raises the stakes in his war on crime.' })
    expect(redact(x)).not.toContain('Batman')
  })

  it('shows the retold plot when there is one, and the blacked-out original if TMDB\'s plot has changed since', () => {
    const x = t({ title: 'Fight Club', characters: ['Tyler Durden'], aliases: [], keywords: [],
      overview: 'A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.' })
    const retold = 'A disturbed man and a slippery salesman channel raw male aggression into a shocking new kind of therapy.'
    const [fresh] = withBlindPlots([x], { [x.id]: { src: x.overview, text: retold } })
    expect(blindPlot(fresh)).toBe(retold)
    const [stale] = withBlindPlots([x], { [x.id]: { src: 'An older TMDB plot.', text: retold } })
    expect(stale.blind).toBeUndefined()
    expect(blindPlot(stale)).toBe(redact(stale))
  })

  it('skips a retold plot too short to judge', () => {
    const S = setUp()
    const pool = prepareTitles(Array.from({ length: 12 }, (_, i) => title({
      genres: ['drama'], characters: ['Ann'], aliases: [], keywords: [],
      overview: 'A long and winding story about a family that moves to a quiet town and discovers what its neighbours have hidden for years.',
      blind: i % 2 ? 'The early life of a boy genius.' : 'A family moves to a quiet town and slowly uncovers what the neighbours have been hiding for years.',
    } as never)))
    const deck = blindDeck(S, pool, LEVELS.blind[0])
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.every(x => (x.blind ?? '').length >= 45)).toBe(true)
  })

  it('hides a word from a character name only where it is used as a name', () => {
    const x = t({ title: 'Guardians of the Galaxy', characters: ['Peter Quill', 'Nova Prime', 'Agent Coulson'], aliases: [], keywords: [],
      overview: 'Peter Quill becomes the prime target of a manhunt, chased by an FBI agent and Nova Prime himself.' })
    const r = redact(x)
    expect(r).not.toMatch(/Peter|Quill|Prime/)
    expect(r).toContain('the prime target')
    expect(r).toContain('an FBI agent')
  })

  it('deals Other Side stories only from titles with a full set of five written clues', () => {
    const S = setUp()
    const five = Array.from({ length: 5 }, (_, i) => ({ who: `Side character ${i + 1}`, text: `Clue ${i + 1}.`, src: 'film' as const }))
    const pool = prepareTitles(Array.from({ length: 10 }, () => title({ genres: ['drama'] })))
    const withClues = withSideClues(pool, Object.fromEntries(pool.map((x, i) => [x.id, i % 2 ? five : five.slice(0, 3)])))
    expect(sideClues(withClues[1])[0].who).toBe('Side character 1')
    expect(withClues[0].side).toBeUndefined()
    const deck = otherDeck(S, withClues, LEVELS.other[0])
    expect(deck.length).toBe(3)
    expect(deck.every(x => sideClues(x).length === 5)).toBe(true)
  })

  it('suggests typed titles from the whole catalogue: starts-with first, accents ignored, wrong guesses left out', () => {
    const cat = prepareTitles([
      title({ genres: ['drama'], title: 'Léon: The Professional', pop: 0.5 }),
      title({ genres: ['drama'], title: 'The Lion King', pop: 0.8 }),
      title({ genres: ['drama'], title: 'Leonardo', pop: 0.9 }),
      title({ genres: ['drama'], title: 'Chameleon Street', pop: 0.1 }),
    ] as never)
    expect(titleSearch(cat, 'l')).toEqual([])                                   // needs two characters
    expect(titleSearch(cat, 'leon').map(t => t.title)).toEqual(['Leonardo', 'Léon: The Professional', 'Chameleon Street'])
    expect(titleSearch(cat, 'lion').map(t => t.title)).toEqual(['The Lion King'])   // a word inside the title
    expect(titleSearch(cat, 'leon', [cat[2].id]).map(t => t.title)).not.toContain('Leonardo')
  })

  it('never serves the same story twice, and never a "Never" genre', () => {
    const S = setUp()
    S.gen.horror = -9
    const lv = LEVELS.blind[0]
    const pool = prepareTitles(Array.from({ length: 30 }, (_, i) => title({
      genres: [i % 5 === 0 ? 'horror' : 'drama'], characters: ['Ann'], aliases: [], keywords: [],
      overview: 'A long and winding story about a family that moves to a quiet town and discovers what its neighbours have hidden for years.',
    } as never)))
    const first = blindDeck(S, pool, lv)
    first.forEach(x => markServed(S, 'blind', x.id))
    const second = blindDeck(S, pool, lv)
    expect(first.some(x => x.genres.includes('horror'))).toBe(false)
    expect(second.some(x => first.includes(x))).toBe(false)
  })
})

describe('The Bet', () => {
  it('scores WTW only on an exact match', () => {
    const S = setUp()
    const t = catalogue[0]
    const g = predict(S, t)
    expect(settleBet(S, t, g, g.pred).kind).toBe('wtw')
    const off = g.pred === 5 ? 4 : g.pred + 1
    expect(settleBet(S, t, g, off).kind).toBe('you')
  })

  it('predictions stay within 1–5 stars', () => {
    const S = setUp()
    for (const t of catalogue.slice(0, 20)) {
      const { pred } = predict(S, t)
      expect(pred).toBeGreaterThanOrEqual(1)
      expect(pred).toBeLessThanOrEqual(5)
    }
  })
})

describe('hunches', () => {
  it('no hunch while the brain can\'t yet call the player\'s picks', () => {
    const S = setUp()
    S.sw.tone = 10; S.sv.tone = 6
    S.preds = [1, 0, 0, 1, 0, 1, 0, 0]
    expect(hunchCandidate(S)).toBeNull()
  })

  it('a rejected hunch is not offered again and puts the scale back in focus', () => {
    const S = setUp()
    S.sw.tone = 10; S.sv.tone = 6
    S.preds = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]   // the brain has been calling this player's picks
    const h = hunchCandidate(S)!
    expect(h.key).toBe('tone')
    answerHunch(S, h, 'no')
    expect(S.focus).toBe('tone')
    expect(hunchCandidate(S)?.key).not.toBe('tone')
  })
})

describe('variety', () => {
  const series = prepareTitles([
    ...Array.from({ length: 8 }, (_, i) => title({ genres: ['action'], collection: 'Saga', title: `Saga ${i}` } as never)),
    ...Array.from({ length: 10 }, () => title({ genres: ['action'], groups: ['superhero'] } as never)),
    ...Array.from({ length: 30 }, () => title({ genres: ['action'] })),
  ].map(t => ({ ...t, collection: t.collection ?? null, groups: t.groups ?? [] })))

  const play = (S: PlayState, n: number, pickSide: (p: Pair) => 'a' | 'b' | 'neither') => {
    const shown: Pair[] = []
    const rand = seeded(41)
    for (let i = 0; i < n; i++) {
      const p = nextPair(S, series, {}, rand)
      if (!p) break
      shown.push(p)
      const side = pickSide(p)
      if (side === 'neither') neither(S, p); else choose(S, p, side)
    }
    return shown
  }

  it('shows at most two films from one series', () => {
    const S = setUp({ sel: ['action'] }); S.gen.action = 2
    const shown = play(S, 20, () => 'a')
    const saga = new Set(shown.flatMap(p => [p.a, p.b]).filter(t => t.collection === 'Saga').map(t => t.id))
    expect(saga.size).toBeLessThanOrEqual(2)
  })

  it('never pairs two titles from the same series or the same group', () => {
    const S = setUp({ sel: ['action'] }); S.gen.action = 2
    for (const p of play(S, 20, () => 'b')) {
      expect(p.a.collection && p.a.collection === p.b.collection).toBeFalsy()
      expect(p.a.groups.includes('superhero') && p.b.groups.includes('superhero')).toBe(false)
    }
  })

  it('stops showing a group the player keeps turning down', () => {
    const S = setUp({ sel: ['action'] }); S.gen.action = 2
    const hero = (t: Pair['a']) => t.groups.includes('superhero')
    play(S, 12, p => (hero(p.a) ? 'b' : hero(p.b) ? 'a' : 'a'))
    const later = play(S, 10, () => 'a')
    expect(later.flatMap(p => [p.a, p.b]).filter(hero)).toHaveLength(0)
  })
})

describe('season steps can run', () => {
  it('has a genre for the Knockout at its odd step number', async () => {
    const { blockGenre } = await import('@/app/play/lib/blocks')
    const S = setUp()
    const big = prepareTitles(Array.from({ length: 40 }, () => title({ genres: ['comedy'] })))
    expect(blockGenre(S, big, 'knockout', 3)).toBe('comedy')
  })
})

describe('the final round', () => {
  // Same "real taste" as above: always takes the funnier, lighter title.
  const u = (t: Pair['a']) => (t.scales.tone ?? 0) - (t.scales.dark ?? 0)
  const consistent = (p: Pair): 'a' | 'b' => (u(p.a) >= u(p.b) ? 'a' : 'b')
  const trained = () => {
    const S = setUp(), rand = seeded(41)
    for (let i = 0; i < 40; i++) { const p = nextPair(S, catalogue, {}, rand); if (p) choose(S, p, consistent(p)) }
    return S
  }

  it('calls a player it has learned, on pairs a genres-only brain can only guess', () => {
    const S = trained(), genresOnly = setUp(), rand = seeded(43)
    let hits = 0, guesses = 0, n = 0
    for (let i = 0; i < 10; i++) {
      const p = showdownPair(S, catalogue, i, rand)
      if (!p) break
      const side = consistent(p)
      if (side === p.call) hits++
      if (side === (recScore(genresOnly, p.a).s >= recScore(genresOnly, p.b).s ? 'a' : 'b')) guesses++
      choose(S, p, side); n++
    }
    expect(n).toBe(10)
    expect(hits).toBeGreaterThanOrEqual(8)
    expect(guesses).toBeLessThan(hits)
  })

  it('seals the call on the title the brain scores higher, and never shows a "Never" genre', () => {
    const S = trained()
    S.gen.horror = -9
    const p = showdownPair(S, catalogue, 0, seeded(47))!
    expect(p.call).toBe(recScore(S, p.a).s >= recScore(S, p.b).s ? 'a' : 'b')
    expect([p.a, p.b].some(x => x.genres.includes('horror'))).toBe(false)
    expect(p.a.type).toBe(p.b.type)
  })
})

describe('the reveal', () => {
  it('sets the tone by the final-round score, out of 10 or (old saves) 5', () => {
    expect(revealTier(8, 10)).toBe('high')
    expect(revealTier(7, 10)).toBe('high')
    expect(revealTier(6, 10)).toBe('mid')
    expect(revealTier(4, 10)).toBe('mid')
    expect(revealTier(3, 10)).toBe('low')
    expect(revealTier(4, 5)).toBe('high')
    expect(revealTier(2, 5)).toBe('mid')
    expect(revealTier(undefined, 10)).toBe('mid')
  })

  it('builds a facts-only headline from the player\'s own genres, strongest first', () => {
    const S = setUp()
    S.sel = ['drama', 'comedy', 'action']
    S.loved = ['drama', 'comedy']
    S.gen.action = 3.4                                   // picks moved it; what they said at setup still wins
    expect(factHeadline(S)).toBe('Drama, comedy & a soft spot for action')
    S.sel = ['thriller']; S.loved = ['thriller']
    expect(factHeadline(S)).toBe('Thriller and mystery, first and foremost')
    S.sel = ['drama', 'comedy']; S.loved = undefined; S.gen.drama = 2; S.gen.comedy = 1   // older save
    expect(factHeadline(S)).toBe('Drama, with a soft spot for comedy')
  })

  it('confetti only at 7/10 or better; no name or ticks unless the brain really reads the player', () => {
    const S = setUp({ showdownScore: 8, showdownN: 10 })
    const unsure = revealOf(S)
    expect(unsure.confetti).toBe(true)
    expect(unsure.ticks).toEqual([])
    expect(unsure.headline).toBe(factHeadline(S))
    const mid = revealOf(setUp({ showdownScore: 5, showdownN: 10 }))
    expect(mid.confetti).toBe(false)
    expect(mid.yay).not.toMatch(/🎉/)
    expect(mid.note).toMatch(/5 of your 10/)
    const low = revealOf(setUp({ showdownScore: 2, showdownN: 10 }))
    expect(low.confetti).toBe(false)
    expect(low.headline).toBe('I called just 2 of your 10')
    expect(low.cta).not.toMatch(/🍿/)
  })

  it('names the player once the brain calls their picks', () => {
    const S = trainedReader()
    S.showdownScore = 9; S.showdownN = 10
    const r = revealOf(S)
    expect(readsYou(S)).toBe(true)
    expect(r.headline).toBe(viewerName(S))
    expect(r.eyebrow).toMatch(/I know who you are/)
  })
})

function trainedReader(): PlayState {
  const S = setUp(), rand = seeded(53)
  const u = (t: Pair['a']) => (t.scales.tone ?? 0) - (t.scales.dark ?? 0)
  for (let i = 0; i < 40; i++) { const p = nextPair(S, catalogue, {}, rand); if (p) choose(S, p, u(p.a) >= u(p.b) ? 'a' : 'b') }
  return S
}
