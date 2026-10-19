/**
 * The taste-games "brain": what it believes about a player, which two titles
 * to show next, and how every answer moves the belief. Ported from the
 * approved prototype (docs/prototypes/wtw-taste-test.html, the `brain`,
 * `mirror statements` and `The Bet` sections) with the logic unchanged
 * except where real data forced it — each such place says so.
 *
 * Everything here is pure TypeScript over a plain, JSON-serialisable
 * `PlayState`, so it can be saved as-is (play_state.state) and unit-tested
 * without a browser. Functions that change the state mutate the object they
 * are given; the caller owns copying it for React.
 */
import { GAME_GENRES, type GameGenre } from './genres'
import { CORE_SCALES, EXTRA_SCALES, SCALE_LABELS, SCALE_WORDS, type CoreScale, type GameTitle, type Scale } from './scales'

export const ALL_SCALES: readonly Scale[] = [...CORE_SCALES, ...EXTRA_SCALES]
type Kind = 'movie' | 'tv'
export type Format = 'movies' | 'series' | 'both'

// ── State ─────────────────────────────────────────────────────────

export interface BetRecord { id: string; pred: number; r: number }
/** The live feed's reactions: three taste ratings and "never show me this". */
export type PickReaction = 'loved' | 'liked' | 'disliked' | 'removed'

export interface PlayState {
  /** 3 since the 15-step season (2026-10-18); older saves start fresh. */
  v: 3
  format: Format
  /** 2 love · 1 like · 0 meh · -9 never. Love/like drift with every pick. */
  gen: Record<GameGenre, number>
  /** Love + like genres chosen on the setup screen; null until setup is done. */
  sel: GameGenre[] | null
  /** The genres the player said they love at setup (the rest of `sel` are likes). `gen` drifts with picks; this doesn't. */
  loved?: GameGenre[]
  /** Per scale: evidence weight and weighted sum; the estimate is sv / sw. */
  sw: Record<Scale, number>
  sv: Record<Scale, number>
  /** Per creator: times their title won a duel, and times it was shown. */
  crew: Record<string, number>
  crewSeen: Record<string, number>
  used: string[]
  unseen: string[]
  pairsSeen: string[]
  asked: string[]
  truths: string[]
  huhCount: number
  focus: Scale | null
  widen: boolean
  /** Duel answers so far (drives phases and the every-4-picks hunch). */
  round: number
  /** Training block in progress (1-based) and picks made inside it. */
  block: number
  blockPicks: number
  /**
   * Did the brain call the pick before it was made? 1 = yes, 0 = no, newest
   * last, capped. The only measure of "how well I know you": answering a lot
   * isn't knowing someone, and random tapping should never look like taste.
   */
  preds: number[]
  /**
   * This block only: per scale, how the chosen title differed from the other
   * one (summed, and how many picks). Feeds "This block you kept picking the
   * funnier one" — a fact about the picks, not a claim about the person.
   */
  blockTally?: Partial<Record<Scale, { sum: number; n: number }>>
  /** This block only: ids of the titles the player chose, for the closing fan. */
  blockChosen?: string[]
  /** Per game: every item served, never served again (games.ts). */
  served?: Record<string, string[]>
  /** Per game: best score so far ("personal best"). */
  gameBest?: Record<string, number>
  /** The Other Side: "watched it for me / with the kids / both". Kids-only counts as seen, not taste. */
  seenWith?: Record<string, 'me' | 'kids' | 'both' | 'no'>
  /** The last "Clearest so far" shown on a closing screen, so it isn't repeated. */
  lastClearest?: string
  /** Season finale: how many of the sealed calls were right in the final round. */
  showdownScore?: number
  /** How many calls the final round made (10; saves from before 2026-10-18 had 5). */
  showdownN?: number
  /** Reactions on Tonight's picks. Rated or removed titles leave the picks for good. */
  pickReactions?: Record<string, PickReaction>
  /** Times the player said "it's just a great movie": ratings weigh more in picks. */
  qualityFan?: number
  /** How many titles of each film series have been shown (COLLECTION_CAP). */
  collectionsShown?: Record<string, number>
  /** This block only: pairs answered "Neither". */
  blockPasses?: number
  /**
   * Per loose group (e.g. 'superhero'): +1 each time one is chosen, −1 each
   * time one loses or gets "Neither". At −2 or below the group is avoided.
   */
  groupLean?: Record<string, number>
  betBias: number
  betHistory: BetRecord[]
  gamePlays: number
  games: Record<string, { level: number; plays: number }>
  /** Newest first, capped. Shown in the side panel as the signal log. */
  log: string[]
}

export function freshState(): PlayState {
  const zero = () => Object.fromEntries(ALL_SCALES.map(a => [a, 0])) as Record<Scale, number>
  return {
    v: 3, format: 'both',
    gen: Object.fromEntries(GAME_GENRES.map(g => [g.id, 0])) as Record<GameGenre, number>,
    sel: null, sw: zero(), sv: zero(), crew: {}, crewSeen: {},
    used: [], unseen: [], pairsSeen: [], asked: [], truths: [],
    huhCount: 0, focus: null, widen: false, round: 0,
    block: 1, blockPicks: 0, preds: [],
    betBias: 0, betHistory: [], gamePlays: 0, games: {}, log: [],
  }
}

const LOG_CAP = 60
export function note(S: PlayState, line: string) {
  S.log.unshift(line)
  if (S.log.length > LOG_CAP) S.log.length = LOG_CAP
}

// ── The catalogue, prepared once ─────────────────────────────────

/**
 * A title plus the one creator the games treat as "its" creator. Real data
 * gives every movie a director, where the prototype only tagged a handful of
 * famous names; counting them all would make "You trust <first-time
 * director>" appear after two picks. So a creator counts only when they have
 * at least two titles in the set — the only case a creators duel can use.
 */
export interface Title extends GameTitle { crewName: string | null }

export function prepareTitles(raw: GameTitle[]): Title[] {
  const count = new Map<string, number>()
  for (const t of raw) for (const c of t.creators) count.set(c, (count.get(c) ?? 0) + 1)
  return raw.map(t => ({ ...t, crewName: t.creators.find(c => (count.get(c) ?? 0) >= 2) ?? null }))
}

export const val = (t: GameTitle, a: Scale): number | undefined => t.scales[a]
const v0 = (t: GameTitle, a: Scale) => t.scales[a] ?? 0

// ── Beliefs ──────────────────────────────────────────────────────

export const est = (S: PlayState, a: Scale) => (S.sw[a] ? S.sv[a] / S.sw[a] : 0)
export const conf = (S: PlayState, a: Scale) => 1 - Math.exp(-S.sw[a] / 5.5)

export const loves = (S: PlayState): GameGenre[] =>
  S.sel ?? GAME_GENRES.filter(g => S.gen[g.id] >= 1).map(g => g.id)
export const nevers = (S: PlayState): GameGenre[] =>
  GAME_GENRES.filter(g => S.gen[g.id] <= -5).map(g => g.id)

const PRED_WINDOW = 30

/** Share of recent picks the brain called in advance, and how many it called. */
export function accuracy(S: PlayState): { rate: number; n: number } {
  const n = S.preds.length
  return { rate: n ? S.preds.reduce((s, x) => s + x, 0) / n : 0, n }
}

/**
 * Lower edge of the Wilson interval for a hit rate: the rate we can be fairly
 * sure the brain beats, given how few calls it has made. A plain "60% of the
 * last 30" is not enough — measured 2026-10-16 on the real titles, a random
 * tapper crossed it by luck at pick 19 and got a viewer name.
 */
function lowerBound(hits: number, n: number, z: number): number {
  if (!n) return 0
  const p = hits / n, z2 = z * z
  return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}
const predHits = (S: PlayState) => S.preds.reduce((s, x) => s + x, 0)

/**
 * True once the brain predicts this player clearly better than a coin flip
 * (~98% sure). Gates everything that claims to know them: the viewer name,
 * "% match", trusted creators. Random tapping never gets here.
 */
export function readsYou(S: PlayState): boolean {
  const n = S.preds.length
  return n >= 12 && lowerBound(predHits(S), n, 2) >= 0.5
}

/** Hunches need less than a full read — it's a question the player answers, not a claim. */
export function canHunch(S: PlayState): boolean {
  const n = S.preds.length
  return n >= 8 && lowerBound(predHits(S), n, 1.28) >= 0.5
}

/**
 * How well WTW knows the player, 0..1, for the side panel only: how much it
 * has heard (coverage of the scales) times how often it calls picks right
 * above a coin flip. Unlocks don't use it — they come with finished blocks.
 */
export function knowledge(S: PlayState): number {
  const coverage = CORE_SCALES.reduce((s, a) => s + conf(S, a), 0) / CORE_SCALES.length
  const skill = Math.max(0, Math.min(1, (lowerBound(predHits(S), S.preds.length, 1.28) - 0.45) / 0.4))
  return Math.round(coverage * skill * 100) / 100
}

/**
 * Creators the player keeps choosing: 3+ wins and 75%+ of their duels won —
 * and only once the brain reads the player at all, since a random streak of
 * three is common.
 */
export function trustedCreators(S: PlayState): string[] {
  if (!readsYou(S)) return []
  return Object.keys(S.crew)
    .filter(n => S.crew[n] >= 3 && S.crew[n] / Math.max(1, S.crewSeen[n] ?? 0) >= 0.75)
    .sort((x, y) => S.crew[y] - S.crew[x])
}

// ── Unlocks ───────────────────────────────────────────────────────

/**
 * What finishing a step unlocks. The season's payoff is the finale (step 15):
 * picks, plus the two "I guess you" games, which only make sense once the
 * brain has been tested. The season's own games are always open in Games.
 */
export const UNLOCKS = [
  { after: 15, id: 'picks', name: 'My picks', desc: 'Picks for you, each with the reason why.' },
  { after: 15, id: 'bet', name: 'The Bet', desc: 'I guess your rating before you give it.' },
  { after: 15, id: 'mind', name: 'Mind Reader', desc: 'I pick for you. Tell me if I\'m right.' },
] as const
export type UnlockId = (typeof UNLOCKS)[number]['id']

/** Blocks finished so far. */
export const blocksDone = (S: PlayState) => S.block - 1

export const unlockOf = (id: UnlockId) => UNLOCKS.find(u => u.id === id)!
export const isUnlocked = (S: PlayState, id: UnlockId) => blocksDone(S) >= unlockOf(id).after
/** What finishing block `n` unlocks, if anything. */
export const unlockAfter = (n: number) => UNLOCKS.find(u => u.after === n) ?? null

// ── Which titles may be shown ─────────────────────────────────────

/** A "Never" genre blocks a title it might belong to (`never` ⊇ `genres`). */
export const isBlocked = (S: PlayState, t: GameTitle) =>
  (t.never ?? t.genres).some(g => S.gen[g] <= -5)

export function allowed(S: PlayState, t: Title, kind?: Kind): boolean {
  if (kind && t.type !== kind) return false
  if (S.format === 'movies' && t.type !== 'movie') return false
  if (S.format === 'series' && t.type !== 'tv') return false
  if (isBlocked(S, t)) return false   // "Never" is blocked everywhere
  if (!S.widen && t.genres.every(g => S.gen[g] < 0)) return false
  const L = loves(S)
  return !L.length || S.widen || t.genres.some(g => L.includes(g))
}

const avail = (S: PlayState, t: Title, kind?: Kind) =>
  allowed(S, t, kind) && !S.used.includes(t.id) && !S.unseen.includes(t.id)

// ── Picking the next duel ─────────────────────────────────────────

export type Phase = 'wide' | 'narrow' | 'deep'
export type PairAxis = Scale | 'crew'

export interface Pair {
  a: Title
  b: Title
  axis: PairAxis
  /** Neither seen: judge by the plot, at reduced weight. */
  pitch: boolean
  unseenCount: number
}

/** Narrows the next pair: a bonus round's kind (series only) or genre (deep dive). */
export interface PairFilter { kind?: Kind; genre?: GameGenre; creators?: boolean }

export function phaseNow(S: PlayState, T: Title[]): Phase {
  const broadDone = (CORE_SCALES.every(a => conf(S, a) >= 0.4) && S.round >= 8) || S.round >= 12
  if (!broadDone) return 'wide'
  return narrowAxis(S, T) ? 'narrow' : 'deep'
}

function narrowAxis(S: PlayState, T: Title[]): Scale | null {
  const comedies = T.filter(t => t.scales.humor !== undefined && avail(S, t, kindFor(S, 'humor'))).length
  if (est(S, 'tone') > 0.25 && conf(S, 'humor') < 0.5 && comedies >= 2) return 'humor'
  const shows = T.filter(t => t.scales.commit !== undefined && avail(S, t, 'tv')).length
  if (S.format !== 'movies' && conf(S, 'commit') < 0.5 && shows >= 2) return 'commit'
  return null
}

function kindFor(S: PlayState, axis: PairAxis): Kind {
  if (axis === 'commit') return 'tv'
  if (S.format === 'movies') return 'movie'
  if (S.format === 'series') return 'tv'
  return S.round % 3 === 2 ? 'tv' : 'movie'
}

function distToUser(S: PlayState, t: Title, skip?: Scale): number {
  let d = 0, n = 0
  for (const a of CORE_SCALES) {
    if (a === skip || conf(S, a) < 0.4) continue
    d += Math.abs(v0(t, a) - est(S, a)); n++
  }
  return n ? d / n : 0
}

function pickAxis(S: PlayState, T: Title[], phase: Phase): Scale {
  if (S.focus) { const f = S.focus; S.focus = null; return f }
  if (phase === 'narrow') { const n = narrowAxis(S, T); if (n) return n }
  let best: CoreScale = CORE_SCALES[0], bc = 9
  for (const a of CORE_SCALES) { const c = conf(S, a); if (c < bc - 0.001) { bc = c; best = a } }
  return best
}

export const genreAff = (S: PlayState, t: GameTitle) =>
  t.genres.reduce((s, g) => s + Math.max(-1, Math.min(2, S.gen[g] || 0)), 0) / Math.max(1, t.genres.length)

function scorePair(S: PlayState, x: Title, y: Title, a: Scale, phase: Phase, rand: () => number): number {
  const dx = Math.abs(v0(x, a) - v0(y, a))
  let others = 0
  for (const b of CORE_SCALES) if (b !== a) others += Math.abs(v0(x, b) - v0(y, b))
  const popW = phase === 'wide' ? 1.3 : 0.45, regW = phase === 'wide' ? 0 : 0.9
  return dx * 2.2 - others * 0.3 + popW * (x.pop + y.pop)
    - regW * (distToUser(S, x, a) + distToUser(S, y, a))
    + 0.25 * (genreAff(S, x) + genreAff(S, y)) + rand() * 0.2
}

export const pairKey = (x: { id: string }, y: { id: string }) => [x.id, y.id].sort().join('|')

function crewPair(S: PlayState, T: Title[], kind: Kind): Pair | null {
  const near = (arr: Title[]) => arr.sort((p, q) => distToUser(S, p) - distToUser(S, q))
  for (const pool of [
    near(T.filter(t => t.crewName && avail(S, t, kind) && !overCap(S, t))),
    near(T.filter(t => t.crewName && allowed(S, t, kind) && !S.unseen.includes(t.id) && !overCap(S, t))),
  ]) {
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      if (pool[i].crewName !== pool[j].crewName && !clash(pool[i], pool[j]) && !S.pairsSeen.includes(pairKey(pool[i], pool[j]))) {
        return { a: pool[i], b: pool[j], axis: 'crew', pitch: false, unseenCount: 0 }
      }
    }
  }
  return null
}

// ── Variety ───────────────────────────────────────────────────────
//
// Measured 2026-10-18 after Eran's play-through ("how many Marvels are
// there?"): 84 of the 500 titles are superhero/comic, 35% of Action, and the
// most-voted movies are mostly Marvel — so "most relevant" kept meaning
// "another superhero", and 8 Harry Potters waited in line.

/** Titles from one film series the training will ever show. */
const COLLECTION_CAP = 2
/** Recent shown titles that count as "just now" (≈ the last 3 pairs). */
const RECENT = 6

export const groupAvoided = (S: PlayState, g: string) => (S.groupLean?.[g] ?? 0) <= -2

/** Never again: a third film of one series, or a group the player keeps turning down. */
function overCap(S: PlayState, t: GameTitle): boolean {
  if (t.groups?.some(g => groupAvoided(S, g))) return true
  if (!t.collection) return false
  return (S.collectionsShown?.[t.collection] ?? 0) >= COLLECTION_CAP && !S.used.includes(t.id)
}

/** Penalty for showing this title now: same series or group as something just shown. */
function staleness(S: PlayState, t: GameTitle, recent: GameTitle[]): number {
  let p = 0
  if (t.collection && recent.some(r => r.collection === t.collection)) p += 3
  for (const g of t.groups ?? []) if (recent.some(r => r.groups?.includes(g))) p += 2.5
  return p
}

/** Two titles that must not face each other: same series, or both from the same group. */
const clash = (x: GameTitle, y: GameTitle) =>
  (!!x.collection && x.collection === y.collection) || (x.groups ?? []).some(g => (y.groups ?? []).includes(g))

/** Count a group's win or loss (see PlayState.groupLean). */
function groupSignal(S: PlayState, t: GameTitle, d: number) {
  for (const g of t.groups ?? []) (S.groupLean ??= {})[g] = (S.groupLean[g] ?? 0) + d
}

// The pair search is quadratic in the pool; past this size, take the most
// relevant slice first. The prototype had 100 titles; the real set has 500.
const POOL_CAP = 140

export function nextPair(S: PlayState, T: Title[], f: PairFilter = {}, rand = Math.random): Pair | null {
  const phase = phaseNow(S, T)
  if (f.creators) {
    const cp = crewPair(S, T, f.kind ?? kindFor(S, 'crew')) ?? crewPair(S, T, S.format === 'movies' ? 'movie' : 'tv')
    if (cp) return finalize(S, cp, rand)
  }
  if (!f.creators && !f.kind && !f.genre && phase === 'deep' && S.round % 3 === 0) {
    const cp = crewPair(S, T, kindFor(S, 'crew'))
    if (cp) return finalize(S, cp, rand)
  }
  const axis = pickAxis(S, T, phase)
  const kinds: Kind[] = f.kind ? [f.kind] : [kindFor(S, axis), kindFor(S, axis) === 'movie' ? 'tv' : 'movie']
  for (const kind of kinds) {
    if (axis === 'commit' && kind !== 'tv') continue
    let pool = T.filter(t => avail(S, t, kind) && !overCap(S, t))
    const reuse = pool.length < 8
    if (reuse) pool = T.filter(t => allowed(S, t, kind) && !S.unseen.includes(t.id) && !overCap(S, t))
    const byId = new Map(T.map(t => [t.id, t]))
    const recent = S.used.slice(-RECENT).map(id => byId.get(id)).filter((t): t is Title => !!t)
    if (axis === 'humor' || axis === 'commit') pool = pool.filter(t => t.scales[axis] !== undefined)
    if (f.genre) pool = pool.filter(t => t.genres.includes(f.genre!))
    if (pool.length > POOL_CAP) {
      pool = [...pool].sort((p, q) => (q.pop + 0.25 * genreAff(S, q)) - (p.pop + 0.25 * genreAff(S, p))).slice(0, POOL_CAP)
    }
    let best: Pair | null = null, bs = -1e9
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      if (S.pairsSeen.includes(pairKey(pool[i], pool[j]))) continue
      if (clash(pool[i], pool[j])) continue
      let s = scorePair(S, pool[i], pool[j], axis, phase, rand) - staleness(S, pool[i], recent) - staleness(S, pool[j], recent)
      if (reuse) s -= (S.used.includes(pool[i].id) ? 0.6 : 0) + (S.used.includes(pool[j].id) ? 0.6 : 0)
      if (s > bs) { bs = s; best = { a: pool[i], b: pool[j], axis, pitch: false, unseenCount: 0 } }
    }
    if (best) return finalize(S, best, rand)
  }
  if (!S.widen) {
    // Very narrow taste: rather than stop, mix in neighbouring genres (never the "never" ones).
    S.widen = true
    note(S, 'Running low on titles in your genres. Mixing in a few neighbours')
    return nextPair(S, T, f, rand)
  }
  return null
}

function finalize(S: PlayState, p: Pair, rand: () => number): Pair {
  S.pairsSeen.push(pairKey(p.a, p.b))
  for (const t of [p.a, p.b]) if (t.collection && !S.used.includes(t.id)) (S.collectionsShown ??= {})[t.collection] = (S.collectionsShown[t.collection] ?? 0) + 1
  if (rand() < 0.5) [p.a, p.b] = [p.b, p.a]
  for (const t of [p.a, p.b]) if (!S.used.includes(t.id)) S.used.push(t.id)
  return p
}

// ── Final round ───────────────────────────────────────────────────

/** Share of the pool, best first, both final-round titles must come from. */
const SHOWDOWN_FLOOR = 0.5

/**
 * A final-round pair, with the brain's call sealed. Training asks what the
 * brain is least sure of (that's how it learns), so calling those pairs is a
 * coin flip by design — Eran's season scored 2/5 that way while the brain
 * called 67% of his ordinary picks. The final round is the test, so it asks
 * what the brain has a clear opinion on: the widest score gap among titles
 * that both rank in the top half of what's on offer (never "your genre vs a
 * dud"). It's chosen from the brain's own scores before the pick, so a
 * random tapper still lands near half.
 */
export function showdownPair(S: PlayState, T: Title[], round: number, rand = Math.random): (Pair & { call: 'a' | 'b' }) | null {
  const prefer: Kind = S.format === 'movies' ? 'movie' : S.format === 'series' ? 'tv' : round % 3 === 2 ? 'tv' : 'movie'
  const byId = new Map(T.map(t => [t.id, t]))
  const recent = S.used.slice(-RECENT).map(id => byId.get(id)).filter((t): t is Title => !!t)
  for (const kind of [prefer, prefer === 'movie' ? 'tv' : 'movie'] as Kind[]) {
    if (S.format === 'movies' && kind === 'tv') continue
    if (S.format === 'series' && kind === 'movie') continue
    let pool = T.filter(t => avail(S, t, kind) && !overCap(S, t))
    if (pool.length < 8) pool = T.filter(t => allowed(S, t, kind) && !S.unseen.includes(t.id) && !overCap(S, t))
    if (pool.length > POOL_CAP) pool = [...pool].sort((p, q) => (q.pop + 0.25 * genreAff(S, q)) - (p.pop + 0.25 * genreAff(S, p))).slice(0, POOL_CAP)
    const ranked = pool.map(t => ({ t, s: recScore(S, t).s })).sort((x, y) => y.s - x.s)
    const top = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * SHOWDOWN_FLOOR)))
    let best: { a: Title; b: Title } | null = null, bs = -1e9
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const x = top[i], y = top[j]
      if (clash(x.t, y.t) || S.pairsSeen.includes(pairKey(x.t, y.t))) continue
      const s = (x.s - y.s) - 0.3 * (staleness(S, x.t, recent) + staleness(S, y.t, recent)) + rand() * 0.02
      if (s > bs) { bs = s; best = { a: x.t, b: y.t } }
    }
    if (best) {
      const { a, b } = best
      // What this pick tests: the trait the two differ on most.
      const axis = CORE_SCALES.reduce((m, s) => (Math.abs(v0(a, s) - v0(b, s)) > Math.abs(v0(a, m) - v0(b, m)) ? s : m), CORE_SCALES[0])
      const p = finalize(S, { a, b, axis, pitch: false, unseenCount: 0 }, rand)
      return { ...p, call: recScore(S, p.a).s >= recScore(S, p.b).s ? 'a' : 'b' }
    }
  }
  return null
}

/** Plain-words name of what a pair tests, e.g. "serious vs funny". */
export const TEST_LABEL = (a: PairAxis) =>
  a === 'crew' ? 'whose style you trust' : `${SCALE_LABELS[a][0].toLowerCase()} vs ${SCALE_LABELS[a][1].toLowerCase()}`

// ── Answers ───────────────────────────────────────────────────────

function nudge(S: PlayState, a: Scale, dir: number, w: number) {
  S.sv[a] += dir * w
  S.sw[a] += Math.abs(dir) * w
}

/** "Haven't seen": swap that side for a similar title, or fall back to plots. */
export function replaceSide(S: PlayState, T: Title[], p: Pair, side: 'a' | 'b'): void {
  const o = p[side], other = side === 'a' ? p.b : p.a
  if (!S.unseen.includes(o.id)) S.unseen.push(o.id)
  if (o.pop < 0.55) { nudge(S, 'indie', -0.6, 0.35); note(S, `Hasn't seen ${o.title} (less known). Leans a little mainstream`) }
  else note(S, `Hasn't seen ${o.title}. Swapped it for something similar`)
  p.unseenCount++
  if (p.unseenCount >= 2) { p.pitch = true; return }
  let best: Title | null = null, bs = -1e9
  const ax = p.axis === 'crew' ? null : p.axis
  for (const c of T) {
    if (!allowed(S, c, o.type) || S.unseen.includes(c.id) || c.id === other.id || c.id === o.id) continue
    if (ax && (ax === 'humor' || ax === 'commit') && c.scales[ax] === undefined) continue
    if (p.axis === 'crew' && (!c.crewName || c.crewName === other.crewName)) continue
    if (overCap(S, c) || clash(c, other)) continue
    let s = c.pop * 1.4 - (S.used.includes(c.id) ? 1.2 : 0)
    if (ax) s -= Math.abs(v0(c, ax) - v0(o, ax)) * 2.5
    for (const b of CORE_SCALES) if (b !== ax) s -= Math.abs(v0(c, b) - v0(o, b)) * 0.15
    if (s > bs) { bs = s; best = c }
  }
  if (!best) { p.pitch = true; return }
  if (!S.used.includes(best.id)) S.used.push(best.id)
  p[side] = best
}

function genreSignal(S: PlayState, win: GameTitle, lose: GameTitle) {
  for (const g of win.genres) if (S.gen[g] > -5) S.gen[g] = round2(S.gen[g] + 0.15)
  for (const g of lose.genres) if (S.gen[g] > -5 && !win.genres.includes(g)) S.gen[g] = round2(S.gen[g] - 0.08)
}
const round2 = (x: number) => Math.round(x * 100) / 100

/** A pick that went against a strong pattern — asked about once ("Plot twist"). */
export interface Huh { axis: Scale; chosen: Title; lastUpd: number }

export interface ChooseResult { learned: string; huh: Huh | null }

export function choose(S: PlayState, p: Pair, side: 'a' | 'b'): ChooseResult {
  const c = p[side], o = side === 'a' ? p.b : p.a, w = p.pitch ? 0.6 : 1
  recordPrediction(S, p, side)
  const before = Object.fromEntries(ALL_SCALES.map(a => [a, conf(S, a)])) as Record<Scale, number>
  let huh: Huh | null = null
  let lastUpd = 0
  if (p.axis !== 'crew') {
    const a = p.axis, e = est(S, a), d = (val(c, a) ?? 0) - (val(o, a) ?? 0)
    if (conf(S, a) > 0.5 && Math.abs(e) > 0.35 && Math.sign(d) !== Math.sign(e) && Math.abs(d) > 0.7 && S.huhCount < 2) {
      huh = { axis: a, chosen: c, lastUpd: 0 }
    }
  }
  const moved: string[] = []
  for (const a of ALL_SCALES) {
    const vc = val(c, a), vo = val(o, a)
    if (vc === undefined || vo === undefined) continue
    const d = vc - vo
    if (Math.abs(d) < 0.15) continue
    const f = a === p.axis || p.axis === 'crew' ? 1 : 0.3
    nudgeSigned(S, a, d * w * f)
    if (Math.abs(d) > 0.8 && f === 1) moved.push(SCALE_WORDS[a][d > 0 ? 1 : 0])
    if (a === p.axis) lastUpd = d * w * f
  }
  if (huh) huh.lastUpd = lastUpd
  if (c.crewName) S.crew[c.crewName] = (S.crew[c.crewName] || 0) + 1
  for (const t of [c, o]) if (t.crewName) S.crewSeen[t.crewName] = (S.crewSeen[t.crewName] || 0) + 1
  groupSignal(S, c, 1)
  groupSignal(S, o, -1)
  genreSignal(S, c, o)
  note(S, `${p.pitch ? 'Would rather watch' : 'Picked'} ${c.title} over ${o.title}${moved.length ? `: ${moved.slice(0, 2).join(', ')}` : ''}${p.pitch ? ' (half weight, hasn\'t seen either)' : ''}`)
  let learned = ''
  for (const a of ALL_SCALES) {
    if (before[a] < 0.5 && conf(S, a) >= 0.5 && Math.abs(est(S, a)) > 0.3) {
      learned = `Noted: ${SCALE_WORDS[a][est(S, a) > 0 ? 1 : 0]} wins for you.`
      break
    }
  }
  if (!learned && c.crewName && trustedCreators(S).includes(c.crewName)) learned = `${c.crewName} again. Noted.`
  S.round++
  return { learned, huh }
}

/**
 * Before learning from a pick, note whether the brain would have called it.
 * Only counts when it had an opinion (a clear score gap) — a coin flip it
 * declined to make is neither a hit nor a miss.
 */
function recordPrediction(S: PlayState, p: Pair, side: 'a' | 'b') {
  if (S.round < 3) return
  const gap = recScore(S, p.a).s - recScore(S, p.b).s
  if (Math.abs(gap) < 0.05) return
  S.preds.push((gap > 0) === (side === 'a') ? 1 : 0)
  if (S.preds.length > PRED_WINDOW) S.preds.splice(0, S.preds.length - PRED_WINDOW)
}

/** Count one pick into this block's tally (see PlayState.blockTally). */
export function tallyPick(S: PlayState, chosen: GameTitle, other: GameTitle) {
  const tally = (S.blockTally ??= {})
  for (const a of ALL_SCALES) {
    const vc = chosen.scales[a], vo = other.scales[a]
    if (vc === undefined || vo === undefined) continue
    const t = (tally[a] ??= { sum: 0, n: 0 })
    t.sum += vc - vo
    t.n++
  }
}

const LEAN_WORDS: Record<Scale, [string, string]> = {
  tone: ['more serious', 'funnier'], energy: ['talkier', 'more action-packed'], pace: ['slower', 'faster'],
  dark: ['lighter', 'darker'], complex: ['easier to follow', 'more puzzling'], fantastic: ['more down-to-earth', 'more otherworldly'],
  modern: ['older', 'newer'], indie: ['bigger, better-known', 'more off-beat'], humor: ['sillier', 'drier'], commit: ['shorter', 'longer-running'],
}

/**
 * Count a training pick into the current block: the lean tally and the
 * closing screen's posters. Called by the controller, not by choose(), so
 * picks made inside games (Mind Reader) never count into a block.
 */
export function countBlockPick(S: PlayState, chosen: GameTitle[], other: GameTitle | null, pitch: boolean) {
  for (const t of chosen) if (!(S.blockChosen ??= []).includes(t.id)) S.blockChosen.push(t.id)
  if (other && !pitch && chosen.length === 1) tallyPick(S, chosen[0], other)
}

/**
 * "This block you kept picking the *funnier*, *faster* one." Words between
 * asterisks are the ones the closing screen highlights. Null when nothing
 * stood out. `gut` phrases it for Lightning.
 */
export function blockLean(S: PlayState, gut = false): string | null {
  const t = S.blockTally ?? {}
  const strong = (Object.keys(t) as Scale[])
    .map(a => ({ a, avg: t[a]!.n >= 4 ? t[a]!.sum / t[a]!.n : 0 }))   // 4+ real picks, or it's a guess
    .filter(x => Math.abs(x.avg) >= 0.25)
    .sort((x, y) => Math.abs(y.avg) - Math.abs(x.avg))
    .slice(0, 2)
  if (!strong.length) return null
  const words = strong.map(x => `*${LEAN_WORDS[x.a][x.avg > 0 ? 1 : 0]}*`).join(', ')
  return gut ? `Under pressure you went for the ${words} one.` : `This block you kept picking the ${words} one.`
}

/** Net lean toward a creator: positive when their titles win more than they lose. */
const crewLean = (S: PlayState, name: string) => (S.crew[name] || 0) - 0.5 * (S.crewSeen[name] || 0)

/** Adds a signed observation: sv moves by `x`, sw by |x|. */
function nudgeSigned(S: PlayState, a: Scale, x: number) {
  S.sv[a] += x
  S.sw[a] += Math.abs(x)
}

function sharedMove(S: PlayState, p: Pair, sign: 1 | -1) {
  for (const a of CORE_SCALES) {
    const va = v0(p.a, a), vb = v0(p.b, a)
    if (Math.sign(va) === Math.sign(vb) && Math.abs(va) > 0.35 && Math.abs(vb) > 0.35) {
      const m = (va + vb) / 2
      S.sv[a] += sign * m * 0.6
      S.sw[a] += Math.abs(m) * 0.6
    }
  }
  for (const t of [p.a, p.b]) {
    if (t.crewName) {
      S.crew[t.crewName] = (S.crew[t.crewName] || 0) + (sign > 0 ? 0.8 : 0)
      S.crewSeen[t.crewName] = (S.crewSeen[t.crewName] || 0) + 1
    }
    for (const g of t.genres) if (S.gen[g] > -5) S.gen[g] = round2(S.gen[g] + (sign > 0 ? 0.1 : -0.1))
    groupSignal(S, t, sign)
  }
  S.round++
}

export function loveBoth(S: PlayState, p: Pair): string {
  sharedMove(S, p, 1)
  note(S, `Loves both ${p.a.title} and ${p.b.title}. Learning from what they share`)
  return 'Love both? Then I\'ll learn from what they have in common.'
}

export function neither(S: PlayState, p: Pair): string {
  sharedMove(S, p, -1)
  note(S, `Neither ${p.a.title} nor ${p.b.title}. Steering away from what they share`)
  return 'Neither? Then I\'ll steer away from what they have in common.'
}

/** Resolve a "Plot twist" question. */
export type HuhAnswer = 'axis' | 'trait' | 'crew' | 'cast' | 'great' | 'mood' | 'other'

export function resolveHuh(S: PlayState, h: Huh, answer: HuhAnswer): void {
  const c = h.chosen, a = h.axis
  S.huhCount++
  const trait = huhTrait(h)
  if (answer === 'trait') {
    nudge(S, trait, Math.sign(v0(c, trait)), 1.2)
    note(S, `Explained: picked ${c.title} because it's ${SCALE_WORDS[trait][v0(c, trait) > 0 ? 1 : 0]}`)
    S.sv[a] -= h.lastUpd * 0.6
  } else if (answer === 'crew' && c.crewName) {
    S.crew[c.crewName] = (S.crew[c.crewName] || 0) + 2
    note(S, `Explained: picked ${c.title} for ${c.crewName}`)
    S.sv[a] -= h.lastUpd * 0.6
  } else if (answer === 'mood') {
    S.sv[a] -= h.lastUpd * 0.7
    note(S, `Explained: ${c.title} was a mood pick. Not changing the profile much`)
  } else if (answer === 'cast') {
    note(S, `Explained: picked ${c.title} for the cast`)
  } else if (answer === 'axis') {
    // "Actually, I like it dark": the pattern was wrong, not the pick.
    nudge(S, a, Math.sign(v0(c, a)), 1)
    note(S, `Explained: likes ${c.title} for being ${SCALE_WORDS[a][v0(c, a) > 0 ? 1 : 0]}. Rethinking that`)
  } else if (answer === 'great') {
    // Quality over type: the pick says little about the scale, a lot about standards.
    S.sv[a] -= h.lastUpd * 0.6
    S.qualityFan = (S.qualityFan ?? 0) + 1
    note(S, `Explained: ${c.title} is just great. Weighing quality more`)
  } else if (answer === 'other') {
    note(S, `Explained: picked ${c.title} for another reason`)
  }
}

/** The chosen title's most pronounced other trait, offered as the reason. */
export function huhTrait(h: Huh): CoreScale {
  return CORE_SCALES.filter(b => b !== h.axis)
    .sort((x, y) => Math.abs(v0(h.chosen, y)) - Math.abs(v0(h.chosen, x)))[0]
}

// ── Hunches (mirror statements) ───────────────────────────────────

export const SAY: Record<Scale, [string, string]> = {
  tone: ['You take your stories seriously. Jokes can wait.', 'You want to laugh, even when the stakes are high.'],
  energy: ['A great conversation beats a great explosion.', 'You\'d rather watch it happen than hear about it.'],
  pace: ['You\'ll give a slow burn the time it needs.', 'If it drags, you\'re out.'],
  dark: ['You want to leave feeling better than you came in.', 'You\'re drawn to the darker side of people.'],
  complex: ['After a long day, you want a story that just flows.', 'You like a story that makes you work a little.'],
  fantastic: ['You like stories that could actually happen.', 'Give you another world over this one.'],
  modern: ['You\'ve got a soft spot for the classics.', 'You lean toward newer stuff.'],
  indie: ['Big crowd-pleasers are your happy place.', 'You\'ll take an odd little gem over a blockbuster.'],
  humor: ['Big, silly comedy? Absolutely.', 'Dry, witty humor beats slapstick.'],
  commit: ['You like a show that knows when to end.', 'Give you a show you can live in for years.'],
}

export interface Hunch { key: string; text: string; axes?: Scale[]; dir?: number[]; crew?: string }

export function hunchCandidate(S: PlayState): Hunch | null {
  if (!canHunch(S)) return null
  if (!S.asked.includes('combo') && est(S, 'tone') > 0.3 && est(S, 'dark') > 0.3 && conf(S, 'tone') > 0.35 && conf(S, 'dark') > 0.35) {
    return { key: 'combo', text: 'You like your darkness with a punchline.', axes: ['tone', 'dark'], dir: [1, 1] }
  }
  const topCrew = trustedCreators(S).find(n => !S.asked.includes('crew:' + n))
  if (topCrew) {
    return { key: 'crew:' + topCrew, text: `You trust ${topCrew}. Whatever they make, you're in.`, crew: topCrew }
  }
  let best: Scale | null = null, bs = 0
  for (const a of ALL_SCALES) {
    if (S.asked.includes(a) || conf(S, a) < 0.35 || Math.abs(est(S, a)) < 0.3) continue
    const s = Math.abs(est(S, a)) * conf(S, a)
    if (s > bs) { bs = s; best = a }
  }
  if (!best) return null
  return { key: best, text: SAY[best][est(S, best) > 0 ? 1 : 0], axes: [best], dir: [est(S, best) > 0 ? 1 : -1] }
}

/** Up to two titles the player picked that back the hunch — shown as evidence. */
export function hunchEvidence(S: PlayState, T: Title[], h: Hunch): string[] {
  const byTitle = new Map(T.map(t => [t.title, t]))
  const picks = S.log.filter(l => l.startsWith('Picked '))
    .map(l => byTitle.get(l.replace(/^Picked /, '').split(' over ')[0]))
    .filter((t): t is Title => !!t)
  const ev = h.crew
    ? picks.filter(t => t.crewName === h.crew)
    : picks.filter(t => h.axes!.every((a, i) => v0(t, a) * h.dir![i] > 0.3))
  return [...new Set(ev.map(t => t.title))].slice(0, 2)
}

export function answerHunch(S: PlayState, h: Hunch, answer: 'yes' | 'sort' | 'no'): string {
  if (!S.asked.includes(h.key)) S.asked.push(h.key)
  if (answer === 'yes') {
    S.truths.push(h.text)
    for (const a of h.axes ?? []) { S.sw[a] += 2; S.sv[a] += 2 * Math.sign(est(S, a)) }
    if (h.crew) S.crew[h.crew] = (S.crew[h.crew] || 0) + 2
    note(S, `Confirmed: “${h.text}”`)
    return 'Locked in'
  }
  if (answer === 'no') {
    for (const a of h.axes ?? []) { S.sv[a] *= 0.2; S.sw[a] *= 0.5 }
    if (h.crew) S.crew[h.crew] = 0
    S.focus = h.axes ? h.axes[0] : null
    note(S, `Rejected: “${h.text}”. Will re-test`)
    return 'Good to know. I\'ll dig into that.'
  }
  note(S, `Partly: “${h.text}”`)
  return 'Fair. I\'ll keep watching.'
}

// ── Picks ─────────────────────────────────────────────────────────

export interface Rec { t: Title; s: number; parts: { a: CoreScale; k: number }[] }

export function recScore(S: PlayState, t: Title): Rec {
  let s = 0
  const parts: Rec['parts'] = []
  for (const a of CORE_SCALES) { const k = v0(t, a) * est(S, a) * conf(S, a); s += k; parts.push({ a, k }) }
  for (const a of EXTRA_SCALES) if (t.scales[a] !== undefined && S.sw[a] > 0) s += t.scales[a]! * est(S, a) * conf(S, a)
  if (t.crewName && trustedCreators(S).includes(t.crewName)) s += 0.8
  s += genreAff(S, t) * 0.25
  if (S.qualityFan) s += 0.15 * (t.rating - 7) * Math.min(1, S.qualityFan / 2)
  parts.sort((x, y) => y.k - x.k)
  return { t, s, parts }
}

/**
 * Best picks among titles the games haven't shown. Prefers the player's own
 * genres; tops up from neighbours only when those run short.
 */
export function topRecs(S: PlayState, T: Title[], n: number, skip: (id: string) => boolean = () => false): Rec[] {
  const base = T.filter(t => !skip(t.id) && !S.used.includes(t.id) && !S.unseen.includes(t.id) && !S.pickReactions?.[t.id] && !t.groups?.some(g => groupAvoided(S, g)))
  const rank = (arr: Title[]) => arr.map(t => recScore(S, t)).sort((x, y) => y.s - x.s)
  const strict = rank(base.filter(t => allowed(S, t)))
  const w = S.widen
  S.widen = true
  const extra = strict.length >= n * 3 ? [] : rank(base.filter(t => allowed(S, t) && !strict.some(x => x.t === t)))
  S.widen = w
  return diversify([...strict, ...extra], n)
}

/**
 * Saved titles (the watchlist) are left out, like the live feed (watchlist-plan
 * decision 2): the caller passes `skip`.
 *
 * The picks a player sees: movies and series ranked separately when they
 * watch both (they score on different evidence), then mixed.
 */
export function mixedPicks(S: PlayState, T: Title[], n: number, skip?: (id: string) => boolean): Rec[] {
  if (S.format !== 'both') return topRecs(S, T, n, skip)
  const tv = topRecs(S, T.filter(t => t.type === 'tv'), Math.floor(n / 2), skip)
  const movies = topRecs(S, T.filter(t => t.type === 'movie'), n - tv.length, skip)
  return [...movies, ...tv].sort((x, y) => y.s - x.s)
}

/** Best first, but one title per film series and at most two from any loose group. */
function diversify(ranked: Rec[], n: number): Rec[] {
  const out: Rec[] = [], series = new Set<string>(), groups: Record<string, number> = {}
  for (const r of ranked) {
    if (out.length >= n) break
    if (r.t.collection && series.has(r.t.collection)) continue
    if ((r.t.groups ?? []).some(g => (groups[g] ?? 0) >= 2)) continue
    out.push(r)
    if (r.t.collection) series.add(r.t.collection)
    for (const g of r.t.groups ?? []) groups[g] = (groups[g] ?? 0) + 1
  }
  return out
}

/** The "Why this?" line under a pick. Only ever names something the player did. */
export function recReason(S: PlayState, r: Rec): string {
  const crews = trustedCreators(S)
  if (r.t.crewName && crews.includes(r.t.crewName)) return `It's ${r.t.crewName}, and you trust them.`
  // "Right in your zone" is a claim about the player: only once hunches are earned.
  const [x, y] = r.parts.filter(p => p.k > 0)
  if (canHunch(S) && x && y) { const w = SCALE_WORDS[x.a][v0(r.t, x.a) > 0 ? 1 : 0]; return `${w[0].toUpperCase()}${w.slice(1)} and ${SCALE_WORDS[y.a][v0(r.t, y.a) > 0 ? 1 : 0]}, right in your zone.` }
  const mine = r.t.genres.filter(g => (S.sel ?? []).includes(g))
  if (mine.length) return `From your genres: ${mine.map(g => GAME_GENRES.find(x => x.id === g)!.label).join(', ')}.`
  return 'Close to what you picked so far.'
}

/**
 * "Why this pick?" — the reasons for AND against, each backed by something
 * the player did (product rule: positive and negative signals, CLAUDE.md).
 * Scales only count once the brain is fairly sure which way the player leans.
 */
export function whyPick(S: PlayState, t: Title): { pros: string[]; cons: string[] } {
  const pros: string[] = [], cons: string[] = []
  if (t.crewName && trustedCreators(S).includes(t.crewName)) pros.push(`It's ${t.crewName}, and you keep choosing their work.`)
  const loved = t.genres.filter(g => (S.sel ?? []).includes(g) && S.gen[g] >= 1)
  const names = loved.map(g => GAME_GENRES.find(x => x.id === g)!.label)
  if (names.length) pros.push(`${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}: ${names.length > 1 ? 'genres' : 'a genre'} you picked.`)
  const scales = !canHunch(S) ? [] : [...CORE_SCALES, ...EXTRA_SCALES].filter(a => t.scales[a] !== undefined && conf(S, a) >= 0.35 && Math.abs(est(S, a)) >= 0.25)
    .map(a => ({ a, v: t.scales[a]!, e: est(S, a) }))
    .filter(x => Math.abs(x.v) >= 0.3)
    .sort((x, y) => Math.abs(y.v * y.e) - Math.abs(x.v * x.e))
  for (const { a, v, e } of scales) {
    const side = SCALE_WORDS[a][v > 0 ? 1 : 0]
    if (Math.sign(v) === Math.sign(e)) { if (pros.length < 4) pros.push(`It's ${side}, and so are the titles you pick.`) }
    else if (cons.length < 2) cons.push(`It's ${side}; you usually go the other way.`)
  }
  if (!pros.length) pros.push('Close to what you picked so far.')
  if (!canHunch(S)) cons.push('I don\'t know your taste well enough yet to say more. A few more blocks.')
  return { pros, cons }
}

// ── Profile name ──────────────────────────────────────────────────

const ADJ: Record<CoreScale, [string, string]> = {
  tone: ['Serious', 'Wisecracking'], energy: ['Talky', 'Adrenaline'], pace: ['Patient', 'Restless'],
  dark: ['Sunny', 'Shadow-Loving'], complex: ['Easygoing', 'Puzzle-Hunting'], fantastic: ['Grounded', 'Dreamy'],
  modern: ['Old-School', 'Fresh'], indie: ['Crowd-Pleasing', 'Off-Beat'],
}
const NOUN: Record<CoreScale, [string, string]> = {
  tone: ['Dramatist', 'Joker'], energy: ['Listener', 'Thrill-Seeker'], pace: ['Slow-Burner', 'Sprinter'],
  dark: ['Optimist', 'Noir Fan'], complex: ['Cruiser', 'Detective'], fantastic: ['Realist', 'World-Hopper'],
  modern: ['Classicist', 'Trendspotter'], indie: ['Blockbuster Buff', 'Curator'],
}

export function rankedScales(S: PlayState): { a: CoreScale; s: number }[] {
  return CORE_SCALES.map(a => ({ a, s: Math.abs(est(S, a)) * conf(S, a) })).sort((x, y) => y.s - x.s)
}

export function viewerName(S: PlayState): string | null {
  if (!readsYou(S)) return null
  const [p1, p2] = rankedScales(S)
  return `The ${ADJ[p1.a][est(S, p1.a) > 0 ? 1 : 0]} ${NOUN[p2.a][est(S, p2.a) > 0 ? 1 : 0]}`
}

/** "Something's off": the player sets a scale directly. Their word beats the guesses. */
export function setScale(S: PlayState, a: Scale, value: number): void {
  S.sw[a] = Math.max(S.sw[a], 10)
  S.sv[a] = value * S.sw[a]
  note(S, `You set ${SCALE_LABELS[a][0]} ↔ ${SCALE_LABELS[a][1]} yourself. Your word beats my guesses`)
}

// ── Ratings (The Bet) ─────────────────────────────────────────────

export function predict(S: PlayState, t: Title): { pred: number; raw: number } {
  let s = 0, cs = 0
  for (const a of CORE_SCALES) { s += v0(t, a) * est(S, a) * conf(S, a); cs += conf(S, a) }
  for (const a of EXTRA_SCALES) if (t.scales[a] !== undefined && S.sw[a] > 0) { s += t.scales[a]! * est(S, a) * conf(S, a); cs += conf(S, a) }
  if (t.crewName) s += Math.max(-1, Math.min(1.5, crewLean(S, t.crewName) * 0.4))
  s += genreAff(S, t) * 0.5
  const norm = s / Math.max(1.2, cs * 0.45)
  const raw = 3.2 + norm * 1.9 + S.betBias
  return { pred: Math.max(1, Math.min(5, Math.round(raw))), raw }
}

export function learnFromRating(S: PlayState, t: Title, dev: number, w: number): void {
  for (const a of CORE_SCALES) {
    const v = v0(t, a)
    if (Math.abs(v) > 0.3) { S.sv[a] += v * dev * w; S.sw[a] += Math.abs(v * dev) * w }
  }
  if (t.crewName) S.crew[t.crewName] = (S.crew[t.crewName] || 0) + dev * w
  for (const g of t.genres) if (S.gen[g] > -5) S.gen[g] = round2(S.gen[g] + dev * 0.15 * w)
}

/**
 * A reaction on one of Tonight's picks. Loved/liked/disliked mean "seen it"
 * and teach the brain like a rating; "removed" only hides the title. Slice 2
 * replays these (play_events kind 'pick_reaction') into the live DNA.
 */
export function reactToPick(S: PlayState, t: Title, r: PickReaction): void {
  ;(S.pickReactions ??= {})[t.id] = r
  if (r === 'removed') { note(S, `Removed ${t.title} from your picks`); return }
  const dev = r === 'loved' ? 1 : r === 'liked' ? 0.5 : -1
  learnFromRating(S, t, dev, r === 'loved' ? 0.8 : 0.6)
  groupSignal(S, t, dev > 0 ? 1 : -1)
  note(S, `${r === 'loved' ? 'Loved' : r === 'liked' ? 'Liked' : 'Didn\'t like'} ${t.title} (from your picks)`)
}

/** Settle one bet: who scores, and what the brain learns. */
export function settleBet(S: PlayState, t: Title, guess: { pred: number; raw: number }, r: number) {
  const kind: 'wtw' | 'you' = r === guess.pred ? 'wtw' : 'you'
  const oldBias = S.betBias
  S.betBias = round2(S.betBias + (r - guess.raw) * 0.3)
  learnFromRating(S, t, (r - 3) / 2, 0.6)
  S.betHistory.push({ id: t.id, pred: guess.pred, r })
  let biasNote = ''
  if (Math.abs(S.betBias) > 0.3 && Math.abs(S.betBias) - Math.abs(oldBias) > 0.2) {
    biasNote = S.betBias > 0 ? 'You rate generously. Adjusting.' : 'Tough critic. Adjusting.'
  }
  note(S, `The Bet: ${t.title}. Bet ${guess.pred}★, rated ${r}★. Point to ${kind === 'wtw' ? 'WTW' : 'you'}`)
  return { kind, biasNote }
}
