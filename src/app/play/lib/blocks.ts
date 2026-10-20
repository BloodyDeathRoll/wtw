/**
 * Train my taste is a season of 15 steps (decided with Eran 2026-10-18): a
 * fixed path mixing regular picks, special blocks, three games, a final round
 * and a finale. Players see only a filling bar, never step numbers
 * (2026-10-20). After the season, extra
 * "sharpen" steps keep the old rotation (odd = plain, even = a special kind).
 * `S.block` is the step number; step 1 is the genre setup.
 *
 * The special kinds and the Knockout bracket are ported from the prototype's
 * bonus rounds.
 */
import { GAME_GENRES, type GameGenre } from './genres'
import { CORE_SCALES, SCALE_LABELS, type Scale } from './scales'
import { allowed, blockLean, canHunch, conf, est, genreAff, isBlocked, loves, note, SAY, tallyPick, trustedCreators, type PlayState, type Title } from './brain'

/** Picks in a plain block. Special blocks set their own length. */
export const PICKS_PER_BLOCK = 6
/** The final round, the season's "boss level" (Eran, 2026-10-18: 10, not 5). */
export const SHOWDOWN_PICKS = 10

export type SpecialType = 'knockout' | 'lightning' | 'deepdive' | 'creators' | 'series'
export type GameStep = 'blind' | 'other' | 'hilo'
export type BlockType = 'plain' | SpecialType | GameStep | 'showdown' | 'finale' | 'setup'

/** The season, in order. Index 0 is step 1. */
export const SEASON: BlockType[] = [
  'setup', 'plain', 'knockout', 'plain', 'blind', 'lightning', 'plain', 'other',
  'deepdive', 'plain', 'hilo', 'creators', 'plain', 'showdown', 'finale',
]
export const SEASON_LENGTH = SEASON.length
export const isGameStep = (t: BlockType): t is GameStep => t === 'blind' || t === 'other' || t === 'hilo'
export const seasonDone = (S: PlayState) => S.block > SEASON_LENGTH
export const SPECIAL_ORDER: SpecialType[] = ['knockout', 'lightning', 'deepdive', 'creators', 'series']

/**
 * What the player reads about each kind of block, and the accent it is drawn
 * in. `desc` says what you'll do and why, in one or two plain sentences.
 */
export const BLOCKS: Record<BlockType, { name: string; icon: string; desc: (genre?: string) => string; teach: string; accent: string }> = {
  plain: { name: 'This or that', icon: '⇄', accent: '#D49B3A',
    desc: () => 'Six pairs. Pick the one you\'d rather watch.',
    teach: 'Each pair is chosen to test the thing I\'m least sure about.' },
  knockout: { name: 'Knockout', icon: '🏆', accent: '#ff6b4a',
    desc: g => `Eight ${g ?? ''} titles in a bracket. Pick the winner of each match until one champion is left.`.replace('  ', ' '),
    teach: 'Round 1 pairs opposite ends of one scale, so every match is a clean test.' },
  lightning: { name: 'Lightning', icon: '⚡', accent: '#7fd1ff',
    desc: () => 'Ten pairs in 30 seconds. Don\'t think, just tap. Gut answers are often the most honest.',
    teach: 'Gut reactions with no time to overthink. Fast answers are often the most honest ones.' },
  deepdive: { name: 'Deep dive', icon: '◎', accent: '#3ddc97',
    desc: g => `Six pairs, all ${g ?? 'from one genre you love'}. Helps me tell which kind of ${g ?? 'it'} you like.`,
    teach: 'Fine detail inside one genre: what kind of comedy, what kind of crime.' },
  creators: { name: 'Directors', icon: '✦', accent: '#b46bff',
    desc: () => 'Five pairs, each from a different director or show creator. Helps me learn whose style you trust.',
    teach: 'Trust in a creator is one of the strongest signals there is.' },
  series: { name: 'Series only', icon: '▤', accent: '#ff5fa2',
    desc: () => 'Five pairs, all series. Helps me learn whether you like short and sharp, or something to live in for years.',
    teach: 'Series taste is different from movie taste: commitment, episode length, bingeing.' },
  blind: { name: 'Blind Taste Test', icon: '?', accent: '#3ddc97',
    desc: () => 'Six plots, told without names or giveaways. Would you watch it? Then: can you name it?',
    teach: 'What you like about the story itself, without the poster or the hype.' },
  other: { name: 'The Other Side of the Story', icon: 'O', accent: '#ff5fa2',
    desc: () => 'Three famous stories, told only by their side characters. Name it on the first clue for 5 points.',
    teach: 'Recognising a title early means you know it well. "Watched it with the kids" keeps family viewing out of your taste.' },
  hilo: { name: 'Higher or Lower', icon: '↕', accent: '#ffd23d',
    desc: () => 'Which one has the higher rating? Get 5 in a row.',
    teach: 'A game first. It also shows where your sense of quality meets the crowd\'s.' },
  showdown: { name: 'Final round', icon: '◉', accent: '#b46bff',
    desc: () => 'I seal my guesses for your next 10 picks before you make them. Let\'s see how well I know you.',
    teach: 'The honest test: can the brain call the player\'s picks before they make them?' },
  finale: { name: 'Your taste, revealed', icon: '★', accent: '#D49B3A',
    desc: () => 'Your viewer profile, and all your picks.',
    teach: 'The season\'s payoff: who the player is, then the picks.' },
  setup: { name: 'Your genres', icon: '✓', accent: '#D49B3A', desc: () => 'Love, like or never.', teach: '' },
}

export const genreName = (g: GameGenre) => GAME_GENRES.find(x => x.id === g)!.label

/** Genres with enough titles for an 8-title bracket, the player's own first. */
export function knockoutGenres(S: PlayState, T: Title[]): GameGenre[] {
  // A bracket is all movies or all series, so one format alone needs 8.
  const enough = (g: GameGenre) => {
    const ok = T.filter(t => t.genres.includes(g) && !S.unseen.includes(t.id) && allowed({ ...S, widen: true }, t))
    return ok.filter(t => t.type === 'movie').length >= 8 || ok.filter(t => t.type === 'tv').length >= 8
  }
  const mine = loves(S).filter(enough)
  return mine.length ? mine : GAME_GENRES.map(g => g.id).filter(g => S.gen[g] > -5 && enough(g))
}

/**
 * The kind of step `block`: the season's fixed order for steps 1–15 (a special
 * that can't run here falls back to regular picks), then the old rotation.
 */
export function blockTypeFor(S: PlayState, T: Title[], block: number): BlockType {
  if (block <= SEASON_LENGTH) {
    const t = SEASON[block - 1]
    if (t === 'series' && S.format === 'movies') return 'plain'
    if (t === 'knockout' && !knockoutGenres(S, T).length) return 'plain'
    if (t === 'creators' && T.filter(x => x.crewName && allowed(S, x)).length < 4) return 'plain'
    if (t === 'deepdive' && !deepDiveGenre(S, T, block)) return 'plain'
    return t
  }
  if (block % 2 === 1) return 'plain'
  const turn = block / 2 - 1
  for (let i = 0; i < SPECIAL_ORDER.length; i++) {
    const t = SPECIAL_ORDER[(turn + i) % SPECIAL_ORDER.length]
    if (t === 'series' && S.format === 'movies') continue
    if (t === 'knockout' && !knockoutGenres(S, T).length) continue
    if (t === 'creators' && T.filter(x => x.crewName && allowed(S, x)).length < 4) continue
    if (t === 'deepdive' && !deepDiveGenre(S, T, block)) continue
    return t
  }
  return 'plain'
}

/** The genre a Knockout or Deep dive block is about. */
export function blockGenre(S: PlayState, T: Title[], type: BlockType, block: number): GameGenre | null {
  if (type === 'knockout') { const o = knockoutGenres(S, T); return o.length ? o[Math.floor(block / 2) % o.length] : null }
  if (type === 'deepdive') return deepDiveGenre(S, T, block)
  return null
}

export function deepDiveGenre(S: PlayState, T: Title[], block: number): GameGenre | null {
  const L = loves(S).filter(g => T.filter(t => t.genres.includes(g) && allowed(S, t)).length >= 6)
  return L.length ? L[Math.floor(block / 2) % L.length] : null
}

// ── Knockout ──────────────────────────────────────────────────────

export interface Match { a: Title; b: Title; pitch: boolean; w?: Title }
export interface Cup {
  genre: GameGenre
  name: string
  axis: Scale
  size: 8 | 16
  r: number
  rounds: Match[][]
  mi: number
  reserves: Title[]
  wins: { hi: number; lo: number }
  crewWins: Record<string, number>
  step: 'match' | 'round'
}

export const ROUND_NAMES: Record<8 | 16, string[]> = {
  16: ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'],
  8: ['Quarter-finals', 'Semi-finals', 'Final'],
}

const v0 = (t: Title, a: Scale) => t.scales[a] ?? 0

function shuffle<T>(a: T[], rand: () => number): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

export function knockoutInit(S: PlayState, T: Title[], genre: GameGenre, bigger: boolean, rand = Math.random): Cup {
  let pool = T.filter(t => t.genres.includes(genre) && !isBlocked(S, t) && !S.unseen.includes(t.id))
  if (S.format === 'movies') pool = pool.filter(t => t.type === 'movie')
  if (S.format === 'series') pool = pool.filter(t => t.type === 'tv')
  // One bracket = one format, so movies never face series.
  const movies = pool.filter(t => t.type === 'movie')
  if (movies.length >= 8 && S.format !== 'series') pool = movies
  else pool = pool.filter(t => t.type === 'tv')
  // Prefer titles the player hasn't met yet in training; then the well-known ones.
  pool.sort((x, y) => (S.used.includes(x.id) ? 1 : 0) - (S.used.includes(y.id) ? 1 : 0) || (y.pop + 0.25 * genreAff(S, y)) - (x.pop + 0.25 * genreAff(S, x)))
  const size: 8 | 16 = bigger && pool.length >= 16 ? 16 : 8
  let axis: Scale = 'humor'
  if (genre !== 'comedy' || pool.filter(t => t.scales.humor !== undefined).length < size) {
    let bv = -1
    const top = pool.slice(0, size)
    for (const a of CORE_SCALES) {
      const vs = top.map(t => v0(t, a)), m = vs.reduce((s, x) => s + x, 0) / vs.length
      const v = vs.reduce((s, x) => s + (x - m) ** 2, 0)
      if (v > bv) { bv = v; axis = a }
    }
  }
  const main = pool.filter(t => t.scales[axis] !== undefined).slice(0, size)
  const reserves = pool.filter(t => !main.includes(t) && t.scales[axis] !== undefined)
  main.sort((x, y) => v0(x, axis) - v0(y, axis))
  // Round 1 pairs opposite ends of the scale: every match is a clean test.
  let ms: Match[] = []
  for (let i = 0; i < size / 2; i++) ms.push({ a: main[i], b: main[size - 1 - i], pitch: false })
  ms = shuffle(ms, rand).map(m => (rand() < 0.5 ? { ...m, a: m.b, b: m.a } : m))
  for (const t of main) if (!S.used.includes(t.id)) S.used.push(t.id)
  const name = `${genreName(genre)} Knockout`
  note(S, `Started ${name}. Round 1 pairs opposite ends of ${SCALE_LABELS[axis][0].toLowerCase()} vs ${SCALE_LABELS[axis][1].toLowerCase()}`)
  return { genre, name, axis, size, r: 0, rounds: [ms], mi: 0, reserves, wins: { hi: 0, lo: 0 }, crewWins: {}, step: 'match' }
}

/** Record a match result. Returns the "learned" line to show, if any. */
export function knockoutPick(S: PlayState, C: Cup, side: 'a' | 'b'): string {
  const m = C.rounds[C.r][C.mi], w = m[side], l = side === 'a' ? m.b : m.a, wt = m.pitch ? 0.6 : 1
  m.w = w
  if (!m.pitch) tallyPick(S, w, l)   // contenders for the closing fan come from the bracket itself
  const d = v0(w, C.axis) - v0(l, C.axis)
  if (Math.abs(d) > 0.3) { S.sv[C.axis] += d * wt; S.sw[C.axis] += Math.abs(d) * wt; C.wins[d > 0 ? 'hi' : 'lo']++ }
  for (const a of CORE_SCALES) {
    if (a === C.axis) continue
    const dd = v0(w, a) - v0(l, a)
    if (Math.abs(dd) > 0.6) { S.sv[a] += dd * 0.2 * wt; S.sw[a] += Math.abs(dd) * 0.2 * wt }
  }
  if (w.crewName) { S.crew[w.crewName] = (S.crew[w.crewName] || 0) + 1; C.crewWins[w.crewName] = (C.crewWins[w.crewName] || 0) + 1 }
  for (const t of [w, l]) if (t.crewName) S.crewSeen[t.crewName] = (S.crewSeen[t.crewName] || 0) + 1
  for (const g of w.genres) if (S.gen[g] > -5) S.gen[g] = Math.round((S.gen[g] + 0.15) * 100) / 100
  note(S, `Knockout: ${w.title} beat ${l.title}${Math.abs(d) > 0.3 ? ` (${SCALE_LABELS[C.axis][d > 0 ? 1 : 0].toLowerCase()} wins)` : ''}`)
  const { hi, lo } = C.wins
  return hi >= 3 && hi > lo * 2 ? `${SCALE_LABELS[C.axis][1]} keeps winning.`
    : lo >= 3 && lo > hi * 2 ? `${SCALE_LABELS[C.axis][0]} keeps winning.` : ''
}

/** "Haven't seen" in a bracket: swap in a reserve in round 1, else judge by plot. */
export function knockoutUnseen(S: PlayState, C: Cup, side: 'a' | 'b'): string {
  const m = C.rounds[C.r][C.mi], t = m[side]
  if (!S.unseen.includes(t.id)) S.unseen.push(t.id)
  if (C.r === 0 && C.reserves.length) {
    C.reserves.sort((x, y) => Math.abs(v0(x, C.axis) - v0(t, C.axis)) - Math.abs(v0(y, C.axis) - v0(t, C.axis)))
    const rep = C.reserves.shift()!
    m[side] = rep
    if (!S.used.includes(rep.id)) S.used.push(rep.id)
    note(S, `Knockout: hasn't seen ${t.title}, swapped in ${rep.title}`)
    return 'Swapped in a similar title.'
  }
  m.pitch = true
  note(S, `Knockout: hasn't seen ${t.title}. Judging by description (half weight)`)
  return ''
}

export interface KnockoutResult { champion: Title; runnerUp: Title; lines: string[]; contenders: Title[] }

/** Move to the next match. Returns the result when the final has been played. */
export function knockoutNext(S: PlayState, C: Cup): KnockoutResult | null {
  const names = ROUND_NAMES[C.size]
  C.mi++
  if (C.mi < C.rounds[C.r].length) return null
  if (C.r === names.length - 1) {
    const f = C.rounds[C.r][0], champ = f.w!, ru = f.w === f.a ? f.b : f.a
    const { hi, lo } = C.wins, H = SCALE_LABELS[C.axis][1], Lo = SCALE_LABELS[C.axis][0]
    const lines = [`Your champion is *${champ.title}*.`, hi > lo ? `${H} beat ${Lo.toLowerCase()} ${hi}–${lo} in your bracket.`
      : lo > hi ? `${Lo} beat ${H.toLowerCase()} ${lo}–${hi} in your bracket.` : `${H} and ${Lo.toLowerCase()} split evenly.`]
    const f4 = C.rounds[Math.max(0, C.rounds.length - 2)].flatMap(m => [m.a, m.b])
    if (f4.every(t => (t.year ?? 0) >= 2000)) lines.push('Your final four are all from 2000 or later.')
    else if (f4.every(t => (t.year ?? 9999) < 2000)) lines.push('Your final four are all pre-2000 classics.')
    const cw = Object.entries(C.crewWins).sort((x, y) => y[1] - x[1])[0]
    if (cw && cw[1] >= 2) lines.push(`${cw[0]} won ${cw[1]} matches.`)
    const line = hi > lo ? SAY[C.axis][1] : lo > hi ? SAY[C.axis][0] : null
    if (line && !S.truths.includes(line)) { S.truths.push(line); lines.push(`Added to your profile: “${line}”`) }
    // Every contender, in bracket order, for the closing fan.
    return { champion: champ, runnerUp: ru, lines, contenders: C.rounds[0].flatMap(m => [m.a, m.b]) }
  }
  const ws = C.rounds[C.r].map(x => x.w!)
  const next: Match[] = []
  for (let i = 0; i < ws.length; i += 2) next.push({ a: ws[i], b: ws[i + 1], pitch: false })
  C.rounds.push(next); C.r++; C.mi = 0; C.step = 'round'
  return null
}

/**
 * "What I learned" for a finished block (Knockout adds its own). Only things
 * about taste: how fast someone tapped is shown elsewhere, as a stat.
 */
export function blockLines(S: PlayState, type: BlockType): string[] {
  const lines: string[] = []
  const top = trustedCreators(S)[0]
  if (type === 'creators' && top) lines.push(`*${top}* is now one of your trusted directors.`)
  const lean = blockLean(S, type === 'lightning')
  if (lean) lines.push(lean)
  const passes = S.blockPasses ?? 0
  if (passes >= 3) lines.push(`You passed on ${passes} pairs. Those weren't your kind of titles, and that's noted.`)
  if (type === 'series' && canHunch(S) && conf(S, 'commit') > 0.35) lines.push(SAY.commit[est(S, 'commit') > 0 ? 1 : 0])
  const all: Scale[] = [...CORE_SCALES, 'humor', 'commit']
  // A claim about the player, so only once the brain actually reads them.
  const strongest = !canHunch(S) ? undefined : all.filter(a => conf(S, a) > 0.4).sort((x, y) => Math.abs(est(S, y)) * conf(S, y) - Math.abs(est(S, x)) * conf(S, x))[0]
  const clearest = strongest ? SAY[strongest][est(S, strongest) > 0 ? 1 : 0] : null
  // Said once; repeated on every closing screen it stops meaning anything.
  if (clearest && clearest !== S.lastClearest) { lines.push(`Clearest so far: “${clearest}”`); S.lastClearest = clearest }
  return lines
}
