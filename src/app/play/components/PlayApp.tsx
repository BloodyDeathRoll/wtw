'use client'
/**
 * The taste games' controller: holds the player's state, turns every tap
 * into a brain update + a saved event, and decides which screen comes next.
 *
 * Two buckets (decided with Eran 2026-10-16): Train my taste is a run of
 * blocks — finish one, then the next — and Games unlock as blocks are done.
 *
 * The player's state (`PlayState`) is mutated by the brain functions, so it
 * lives in a ref and is only ever changed inside event handlers — never inside
 * a React state updater, which React may run twice in development.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/modules/session/components/AppShell'
import type { AppUser } from '@/modules/session/types'
import { LEAVE_TIMEOUT_MS, RouteLoading } from '@/app/components/RouteLoading'
import IntroVoice from '@/modules/session/voice/IntroVoice'
import { GAMES_INTRO_AUDIO_SRC, GAMES_INTRO_MESSAGE } from '@/modules/session/voice/intro-copy'
import type { GameTitle } from '../lib/scales'
import type { GameGenre } from '../lib/genres'
import {
  freshState, prepareTitles, isBlocked, nextPair, choose, replaceSide, loveBoth, neither as neitherAns,
  hunchCandidate, answerHunch as answerHunchBrain, countBlockPick, reactToPick as reactToPickBrain, resolveHuh, knowledge, isUnlocked, unlockAfter, unlockOf,
  setScale as setScaleBrain, predict, settleBet, note, pairKey, showdownPair, learnFromRating, tallyPick, blockLean,
  type Pair, type PairFilter, type PlayState, type Title,
} from '../lib/brain'
import {
  PICKS_PER_BLOCK, SHOWDOWN_PICKS, BLOCKS, SEASON_LENGTH, blockTypeFor, blockGenre, isGameStep, seasonDone, knockoutInit, knockoutPick,
  knockoutUnseen, knockoutNext, blockLines, genreName, type BlockType,
} from '../lib/blocks'
import type { PlayEvent } from '../lib/events'
import { LEVELS, blindDeck, otherDeck, hiloNext as hiloChallenger, hiloValue, markServed, options, otherPoints, type GameKind } from '../lib/games'
import type { SavedPlay } from '../lib/server'
import { readLocal, usePersistence } from './persist'
import { demoStateAt } from '../lib/demo'
import { SAVED_FROM, loadAccountWatchlist, saveTitle, savedIds, unsaveTitle, type SaveSource } from '../lib/watchlist'
import type { Ctl, GameId, GameRun, ShowdownRun, SpecialRun, Summary, UI } from './types'
import { GAMES } from './games'
import Screens from './Screens'

// No intro screen (2026-10-20): the first thing a player sees is the genre setup.
const INITIAL_UI: UI = {
  screen: 'setup', pair: null, pairN: 0, learned: '', hunch: null, huh: null,
  blockType: 'plain', blockGenre: null, special: null, cup: null, champion: null, done: null, resume: null, showdown: null, game: null,
  menu: false, toast: '', toastUndo: false, stub: null, editing: false, curtain: false, confirm: null,
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

const duelEvent = (kind: string, p: Pair, extra: Record<string, unknown> = {}): PlayEvent => ({
  kind, item_key: pairKey(p.a, p.b),
  payload: { a: p.a.id, b: p.b.id, axis: p.axis, pitch: p.pitch, ...extra },
})

/** Screens that belong to Train my taste; leaving one remembers it, to return to. */
const TRAINING: UI['screen'][] = ['duel', 'hunch', 'huh', 'blockIntro', 'knockout', 'champion', 'blockDone', 'showdown', 'finale']


const specialFilter = (b: SpecialRun | null): PairFilter =>
  b ? { kind: b.kind, genre: b.genre, creators: b.type === 'creators' } : {}

/** Games pick from everything the player hasn't ruled out, within their genres. */
function allowedForGames(S: PlayState, t: Title): boolean {
  if (S.format === 'movies' && t.type !== 'movie') return false
  if (S.format === 'series' && t.type !== 'tv') return false
  if (isBlocked(S, t)) return false
  const L = S.sel ?? []
  return !L.length || t.genres.some(g => L.includes(g))
}

export default function PlayApp({ user, existingUser, voiceIntro = false, titles, saved, jumpTo, tab }: {
  user: AppUser
  /** Has used the app before (chat or ratings): gets the full menu from the start. */
  existingUser: boolean
  /** A brand-new user who hasn't heard the voice intro: it opens the games (before the genres). */
  voiceIntro?: boolean
  titles: GameTitle[]
  saved: SavedPlay
  /** Local demo only: start a ready-made player at this step (lib/demo.ts). */
  jumpTo?: number
  /** 'games': opened from the home screen's Games button. */
  tab?: 'games'
}) {
  const userId = user.id
  const firstName = (user.name ?? '').trim().split(' ')[0] || null
  const router = useRouter()
  const T = useMemo(() => prepareTitles(titles), [titles])
  const SRef = useRef<PlayState>(saved.state ?? freshState())
  const [ready, setReady] = useState(saved.mode === 'server')
  const [ui, setUI] = useState<UI>(INITIAL_UI)
  // Shown once per visit, before the genres, only to a player who hasn't rated them yet.
  const [introOn, setIntroOn] = useState(voiceIntro && !saved.state?.sel)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const { save, flushNow, status } = usePersistence(userId, saved.mode, saved.version)
  // Leaving for another page of the app: save first (a client-side navigation
  // fires no pagehide), and cover the screen so the tap visibly registers.
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setLeaving(false), LEAVE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [leaving])
  async function leave(href: string) {
    setLeaving(true)
    await flushNow()
    router.push(href)
  }
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoRef = useRef<(() => void) | null>(null)
  const [savedSet, setSaved] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setSaved(savedIds())   // the device's copy first, then the account's list for signed-in players
    if (saved.mode === 'server') void loadAccountWatchlist(userId).then(setSaved).catch(() => {})
  }, [saved.mode, userId])
  const S = SRef.current

  /** Apply a UI change. Always computed from `ui` as of this render. */
  const set = (patch: Partial<UI>) => setUI(prev => ({ ...prev, ...patch }))
  const commit = (events: PlayEvent[] = []) => { save(SRef.current, events); rerender() }

  function toast(msg: string, undo?: () => void) {
    undoRef.current = undo ?? null
    set({ toast: msg, toastUndo: !!undo })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { undoRef.current = null; set({ toast: '', toastUndo: false }) }, undo ? 3500 : 1900)
  }

  /** One list with the live app (lib/watchlist.ts). A save nudges the brain like a light "liked". */
  function toggleSave(t: Title, source: SaveSource) {
    if (savedSet.has(t.id)) {
      unsaveTitle(t.id)
      setSaved(prev => { const n = new Set(prev); n.delete(t.id); return n })
      note(S, `Removed ${t.title} from your watchlist`)
      toast(`Removed ${t.title} from your watchlist`)
      commit([{ kind: 'watchlist_remove', item_key: t.id, payload: { title: t.id, from: source } }])
      return
    }
    saveTitle(t, source)
    setSaved(prev => new Set(prev).add(t.id))
    learnFromRating(S, t, 0.5, 0.3)
    note(S, `Saved ${t.title} to your watchlist (${SAVED_FROM[source].toLowerCase()})`)
    toast(`${t.title} is on your watchlist`, () => {
      unsaveTitle(t.id)
      setSaved(prev => { const n = new Set(prev); n.delete(t.id); return n })
      note(S, `Undid saving ${t.title}`)
      commit([{ kind: 'watchlist_remove', item_key: t.id, payload: { title: t.id, from: source, undo: true } }])
    })
    commit([{ kind: 'watchlist_add', item_key: t.id, payload: { title: t.id, from: source } }])
  }

  // ── blocks ──────────────────────────────────────────────────────

  /** The next duel of a plain block (My taste when the titles run out). */
  function duelPatch(extra: Partial<UI> = {}): Partial<UI> {
    const pair = nextPair(S, T)
    if (!pair) note(S, 'Ran out of fresh titles for now')
    return { learned: '', ...extra, pair, pairN: ui.pairN + 1, screen: pair ? 'duel' : 'hub', special: null }
  }

  /** The intro page of block S.block — every block opens with one, so the player has context. */
  function startBlockPatch(extra: Partial<UI> = {}): Partial<UI> {
    const type = blockTypeFor(S, T, S.block)
    return { ...extra, blockType: type, blockGenre: blockGenre(S, T, type, S.block), pair: null, special: null, cup: null, done: null, screen: 'blockIntro' }
  }

  /** Close the current block: record it, move the counter, show "Block N done". */
  function finishBlock(type: BlockType, lines: string[], events: PlayEvent[], extra: Partial<UI> = {}, stat?: string, fan?: { posters: Title[]; championId: string }): Partial<UI> {
    const finished = S.block
    const byId = new Map(T.map(t => [t.id, t]))
    const posters = fan?.posters ?? (S.blockChosen ?? []).map(id => byId.get(id)).filter((t): t is Title => !!t)
    const g = ui.blockGenre ? genreName(ui.blockGenre) : null
    const label = type === 'plain' ? 'Train my taste'
      : isGameStep(type) ? `🎮 ${BLOCKS[type].name} · Level 1`
      : type === 'knockout' ? `${BLOCKS.knockout.icon} ${g ? `${g} ` : ''}Knockout`
      : `${BLOCKS[type].icon} ${BLOCKS[type].name}${g && type === 'deepdive' ? ` · ${g}` : ''}`
    const unlocked = unlockAfter(finished)?.id ?? null
    note(S, `Finished step ${finished}${type === 'plain' ? '' : ` (${BLOCKS[type].name})`}`)
    if (unlocked) note(S, `Unlocked ${unlockOf(unlocked).name}`)
    events.push({ kind: 'block_done', item_key: `block:${finished}`, payload: { block: finished, type, unlocked } })
    S.block++
    S.blockPicks = 0
    S.blockTally = {}
    S.blockChosen = []
    S.blockPasses = 0
    const next = blockTypeFor(S, T, S.block)
    return {
      ...extra, special: null, cup: null, pair: null, screen: 'blockDone',
      done: { block: finished, type, lines, stat, posters, championId: fan?.championId, label, unlocked, next, nextGenre: blockGenre(S, T, next, S.block) },
    }
  }

  function finishSpecial(b: SpecialRun, timeout: boolean, events: PlayEvent[]): Partial<UI> {
    const secs = Math.round((Date.now() - b.t0) / 1000)
    const stat = b.type === 'lightning' ? (timeout ? `${b.picks} picks before the clock ran out` : `${b.picks} picks in ${secs} seconds`) : undefined
    return finishBlock(b.type, blockLines(S, b.type), events, {}, stat)
  }

  /** Continue a plain block after a question (hunch / plot twist), or close it. */
  function continuePlain(events: PlayEvent[], extra: Partial<UI> = {}): Partial<UI> {
    if (S.blockPicks >= PICKS_PER_BLOCK) return finishBlock('plain', blockLines(S, 'plain'), events, extra)
    return duelPatch(extra)
  }

  /** After a duel answer: next pair, a question, or the end of the block. */
  function afterAnswer(learned: string, huh: UI['huh'], events: PlayEvent[]) {
    if (ui.special) {
      const b = { ...ui.special, left: ui.special.left - 1, picks: ui.special.picks + 1 }
      const timeUp = b.type === 'lightning' && Date.now() - b.t0 >= 30_000
      let patch: Partial<UI>
      if (b.left <= 0 || timeUp) patch = finishSpecial(b, timeUp, events)
      else {
        const pair = nextPair(S, T, specialFilter(b))
        patch = pair ? { special: b, pair, pairN: ui.pairN + 1, learned } : finishSpecial(b, false, events)
      }
      set(patch)
      commit(events)
      return
    }
    S.blockPicks++
    let patch: Partial<UI> | null = null
    if (huh) patch = { huh, screen: 'huh' }
    else if (S.blockPicks < PICKS_PER_BLOCK && S.round > 0 && S.round % 4 === 0) {
      const h = hunchCandidate(S)
      if (h) patch = { hunch: h, screen: 'hunch' }
    }
    set(patch ?? continuePlain(events, { learned }))
    commit(events)
  }

  // First screen: new players start at the intro; returning players land on
  // their picks once unlocked, else straight back into their block.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (saved.mode === 'local') {
      const local = readLocal(userId)
      if (jumpTo) {
        SRef.current = demoStateAt(T, jumpTo)
        save(SRef.current, [])
        window.history.replaceState(null, '', '/play?demo=1')   // a reload keeps the jumped player
      } else if (local?.v === 3) SRef.current = local
      setReady(true)
    }
    const S = SRef.current
    if (!S.sel) return   // genres first, whatever was asked for
    if (tab === 'games') { setUI(prev => ({ ...prev, screen: 'games' })); return }
    if (seasonDone(S)) { setUI(prev => ({ ...prev, screen: 'tonight' })); return }
    const type = blockTypeFor(S, T, S.block)
    if (S.blockPicks > 0) {
      // Part-way through a regular block: carry on with a fresh pair.
      const pair = nextPair(S, T)
      setUI(prev => ({ ...prev, pair, pairN: 1, blockType: 'plain', screen: pair ? 'duel' : 'hub' }))
    } else {
      // Between steps: straight into the next step's intro (no path map up front, 2026-10-20).
      setUI(prev => ({ ...prev, blockType: type, blockGenre: blockGenre(S, T, type, S.block), screen: 'blockIntro' }))
    }
  }, [saved.mode, userId, T, jumpTo, save, tab])

  // ── games ─────────────────────────────────────────────────────────

  function endGame(g: GameRun, summary: Summary): GameRun {
    const d = GAMES.find(x => x.id === g.id)!
    const gp = (S.games[g.id] ??= { level: 0, plays: 0 })
    gp.plays++
    S.gamePlays++
    const before = gp.level
    gp.level = Math.min(5, gp.level + 1)
    note(S, `Finished ${d.name} (level ${before + 1}). ${summary.big ?? ''}`.trim())
    return { ...g, phase: 'over', summary, newLevel: gp.level > before && gp.level < 5 ? d.levels[gp.level] : null }
  }

  function betAdvance(g: GameRun): GameRun {
    const b = g.bet!
    if (b.wtw >= b.target || b.you >= b.target || !b.queue.length) {
      return endGame(g, {
        big: `${b.wtw}–${b.you}`,
        headline: b.wtw > b.you ? 'WTW wins. I know you better than you think.' : b.you > b.wtw ? 'You win. Every miss taught me something.' : 'A draw.',
        lines: [
          `I called ${b.hits} of ${b.played} ratings exactly.`,
          Math.abs(S.betBias) > 0.3 ? (S.betBias > 0 ? 'You rate generously. My future bets will lean higher.' : 'You\'re a tough critic. My future bets will lean lower.') : 'Your star ratings are about where I\'d expect.',
          'Every rating pulled your profile toward what you actually felt.',
        ],
      })
    }
    const [cur, ...queue] = b.queue
    return { ...g, bet: { ...b, cur, queue, guess: predict(S, cur), step: 'rate', res: null } }
  }

  function mindAdvance(g: GameRun): GameRun {
    const M = g.mind!
    if (M.i >= M.n) {
      const pct = Math.round((M.right / Math.max(1, M.n)) * 100)
      return endGame(g, {
        big: `${M.right}/${M.n}`,
        headline: pct >= 75 ? 'I read your mind.' : pct >= 50 ? 'Getting warmer.' : 'You\'re hard to read. Good, that\'s how I learn.',
        lines: [
          `I guessed ${M.right} of ${M.n} picks right (${pct}%).`,
          M.n - M.right ? `The ${M.n - M.right} I got wrong corrected your profile exactly where I was weakest.` : 'Not one miss. Your profile is in great shape.',
          'Every pick here counts just like in Train my taste.',
        ],
      })
    }
    const pair = nextPair(S, T)
    if (!pair) return mindAdvance({ ...g, mind: { ...M, n: M.i } })
    const pa = predict(S, pair.a).raw, pb = predict(S, pair.b).raw
    return { ...g, mind: { ...M, pair, step: 'guess', guess: pa >= pb ? 'a' : 'b', sure: Math.abs(pa - pb) > 0.6 } }
  }

  function startGame(id: GameId) {
    if ((id === 'bet' || id === 'mind') && !isUnlocked(S, id)) { toast('Unlocks when you finish the season.'); return }
    set({ menu: false, game: { id, phase: 'intro', k0: knowledge(S) }, screen: 'game', ...(TRAINING.includes(ui.screen) ? { resume: ui.screen } : {}) })
  }

  // ── season games: Blind Taste Test, The Other Side, Higher or Lower ──

  /** A fresh run of a season game at `level` (0-based). Null when its content has run out. */
  function initGame(id: GameKind, level: number, inPath: boolean): GameRun | null {
    const lv = LEVELS[id][Math.min(level, LEVELS[id].length - 1)]
    const base: GameRun = { id, phase: 'play', k0: knowledge(S), inPath, level }
    if (id === 'blind') {
      const deck = blindDeck(S, T, lv)
      if (deck.length < 3) { toast('New stories every Monday. You\'ve seen them all for now.'); return null }
      deck.forEach(t => markServed(S, 'blind', t.id))
      return { ...base, blind: { deck, i: 0, step: 'watch', opts: options(T, deck[0]), yes: [], no: [], named: 0, last: null } }
    }
    if (id === 'other') {
      const deck = otherDeck(S, T, lv)
      if (deck.length < 2) { toast('New stories every Monday. You\'ve seen them all for now.'); return null }
      deck.forEach(t => markServed(S, 'other', t.id))
      return { ...base, other: { deck, i: 0, clue: 1, opts: options(T, deck[0]), wrong: [], step: 'guess', points: 0, last: null, knewEarly: 0 } }
    }
    const a = hiloChallenger(S, T, lv, null), b = a && hiloChallenger(S, T, lv, a)
    if (!a || !b) { toast('New rounds every Monday. You\'ve played them all for now.'); return null }
    markServed(S, 'hilo', a.id); markServed(S, 'hilo', b.id)
    return { ...base, hilo: { a, b, streak: 0, target: lv.size, step: 'guess', last: null, seen: [a, b] } }
  }

  /** A season game is over: close the step (path) or show the game's result (Games). */
  function finishGame(g: GameRun, result: { big: string; headline: string; lines: string[]; score: number; cleared: boolean; posters: Title[] }, events: PlayEvent[]) {
    const id = g.id as GameKind
    const best = (S.gameBest ??= {})[id] ?? 0
    const newBest = result.score > best
    if (newBest) S.gameBest[id] = result.score
    const stat = `${result.big}${newBest && best > 0 ? ' · personal best' : ''}`
    if (g.inPath) {
      const gp = (S.games[id] ??= { level: 0, plays: 0 })
      gp.plays++
      gp.level = Math.max(gp.level, 1)   // level 1 played on the path counts in Games
      S.gamePlays++
      set({ ...finishBlock(id, result.lines, events, { game: null }, stat, { posters: result.posters, championId: '' }) })
    } else {
      const done = endGame(g, { big: result.big, headline: result.headline, lines: newBest && best > 0 ? [...result.lines, 'A new personal best.'] : result.lines })
      if (!result.cleared) { const gp = S.games[id]; if (gp) gp.level = Math.max(0, gp.level - 1); done.newLevel = null }
      set({ game: done })
    }
    commit(events)
  }

  // ── final round ────────────────────────────────────────────────

  /** Deal the next pair of the final round and seal the brain's call on it. */
  function showdownRound(sd: ShowdownRun): ShowdownRun {
    const dealt = showdownPair(S, T, sd.results.length)
    if (!dealt) return { ...sd, pair: null, step: 'summary' }
    const { call, ...pair } = dealt
    return { ...sd, pair, call, step: 'play' }
  }

  // ── controller ──────────────────────────────────────────────────

  const inSeasonTraining = !!S.sel && !seasonDone(S) && (TRAINING.includes(ui.screen) || (ui.screen === 'game' && !!ui.game?.inPath))
  const ctl: Ctl = {
    S, T, ui, firstName, user,
    existingUser,
    inTraining: inSeasonTraining,
    canSkip: inSeasonTraining,   // from the first screen after the genres (2026-10-20)
    leave(href) { void leave(href) },
    ask: confirm => set({ confirm, menu: false }),
    closeConfirm: () => set({ confirm: null }),
    confirmSkip() {
      S.skipped = true
      note(S, `Skipped the season at step ${S.block}`)
      commit([{ kind: 'skip_season', payload: { block: S.block } }])
      set({ confirm: null })
      // Straight to the picks (2026-10-20).
      void leave('/?stage=recommendations')
    },
    confirmRestart() {
      // A clean slate: back to the genres. The watchlist is the app's, so it stays.
      const from = S.block
      SRef.current = freshState()
      note(SRef.current, `Restarted the calibration (was on step ${from})`)
      set({ ...INITIAL_UI })
      commit([{ kind: 'restart', payload: { from } }])
    },
    saveNote: status === 'local' ? 'Progress is saved in this browser for now.'
      : status === 'conflict' ? 'You\'re playing in another tab. Reload this page to continue here.'
      : status === 'error' ? 'Couldn\'t save just now. Will retry on your next answer.' : '',
    toast,
    isSaved: id => savedSet.has(id),
    toggleSave,
    removeSaved(id, title) {
      unsaveTitle(id)
      setSaved(prev => { const n = new Set(prev); n.delete(id); return n })
      note(S, `Removed ${title} from your watchlist`)
      toast(`Removed ${title} from your watchlist`)
      commit([{ kind: 'watchlist_remove', item_key: id, payload: { title: id, from: 'watchlist' } }])
    },
    undoToast() {
      const u = undoRef.current
      undoRef.current = null
      if (toastTimer.current) clearTimeout(toastTimer.current)
      set({ toast: '', toastUndo: false })
      u?.()
    },
    setMenu: open => set({ menu: open }),
    toggleCurtain: () => set({ curtain: !ui.curtain }),

    go(dest) {
      // Leaving training keeps everything as it was (pair, bracket, timer);
      // coming back resumes it. Only a block not yet started shows its intro.
      const leaving: Partial<UI> = { menu: false, game: null, editing: false }
      if (TRAINING.includes(ui.screen)) leaving.resume = ui.screen
      if (dest === 'duel') {
        if (!S.sel) set({ ...leaving, screen: 'setup' })
        else if (TRAINING.includes(ui.screen)) set({ menu: false })
        else if (ui.resume) set({ ...leaving, screen: ui.resume })
        else if (S.blockPicks > 0) set(duelPatch({ ...leaving, blockType: 'plain' }))
        else set(startBlockPatch(leaving))
      } else if (dest === 'watchlist') {
        setSaved(savedIds())   // the live app may have changed it since
        set({ ...leaving, screen: 'watchlist' })
      } else if (dest === 'settings') {
        set({ ...leaving, stub: dest, screen: 'stub' })
      } else set({ ...leaving, screen: dest })
      commit()
    },

    startSetup: () => set({ screen: 'setup' }),
    setFormat(f) { S.format = f; rerender() },
    rateGenre(g, r) {
      const v = r === 'love' ? 2 : r === 'like' ? 1 : -9
      S.gen[g] = S.gen[g] === v ? 0 : v
      rerender()
    },
    finishSetup() {
      const pick = (lo: number, hi: number) => (Object.keys(S.gen) as GameGenre[]).filter(g => S.gen[g] >= lo && S.gen[g] <= hi)
      const L = pick(1, 99)
      if (!L.length) return
      S.sel = L
      S.loved = pick(2, 99)
      const names = (gs: GameGenre[]) => gs.map(genreName).join(', ')
      note(S, `Watches ${S.format === 'both' ? 'movies and series' : S.format}. Love: ${names(pick(2, 99)) || '-'}. Like: ${names(pick(1, 1)) || '-'}${pick(-99, -5).length ? `. Never: ${names(pick(-99, -5))}` : ''}`)
      S.block = Math.max(S.block, 2)   // step 1 of the season is this genre setup
      set(startBlockPatch())
      commit([{ kind: 'genres', payload: { format: S.format, gen: { ...S.gen } } }])
    },

    pick(side) {
      const p = ui.pair
      if (!p) return
      const r = choose(S, p, side)
      countBlockPick(S, [p[side]], p[side === 'a' ? 'b' : 'a'], p.pitch)
      afterAnswer(r.learned, r.huh, [duelEvent('duel', p, { chosen: p[side].id, block: S.block })])
    },
    unseen(side) {
      const p = ui.pair
      if (!p) return
      const gone = p[side]
      const next = { ...p }
      replaceSide(S, T, next, side)
      set({ pair: next, learned: next.pitch ? '' : 'Swapped in something similar.' })
      commit([{ kind: 'unseen', item_key: gone.id, payload: { title: gone.id } }])
    },
    both() {
      if (!ui.pair) return
      countBlockPick(S, [ui.pair.a, ui.pair.b], null, ui.pair.pitch)
      afterAnswer(loveBoth(S, ui.pair), null, [duelEvent('love_both', ui.pair)])
    },
    neither() {
      if (!ui.pair) return
      S.blockPasses = (S.blockPasses ?? 0) + 1
      afterAnswer(neitherAns(S, ui.pair), null, [duelEvent('neither', ui.pair)])
    },
    skip() {
      const p = ui.pair
      note(S, 'Skipped a pair')
      const next = nextPair(S, T, specialFilter(ui.special))
      set({ pair: next ?? p, pairN: ui.pairN + 1, learned: '' })
      commit(p ? [duelEvent('skip', p)] : [])
    },

    answerHunch(v) {
      const h = ui.hunch
      if (!h) return
      toast(answerHunchBrain(S, h, v))
      const events: PlayEvent[] = [{ kind: 'hunch', item_key: `hunch:${h.key}`, payload: { text: h.text, answer: v } }]
      set(continuePlain(events, { hunch: null }))
      commit(events)
    },
    answerHuh(v) {
      const h = ui.huh
      if (!h) return
      resolveHuh(S, h, v)
      const events: PlayEvent[] = [{ kind: 'plot_twist', item_key: h.chosen.id, payload: { axis: h.axis, answer: v } }]
      set(continuePlain(events, { huh: null, learned: v === 'other' ? '' : 'Thanks, that helps a lot.' }))
      commit(events)
    },

    startBlock() {
      const type = blockTypeFor(S, T, S.block)
      const genre = blockGenre(S, T, type, S.block)
      if (type !== 'plain') note(S, `Step ${S.block}: ${BLOCKS[type].name}`)
      if (isGameStep(type)) {
        const g = initGame(type, 0, true)
        if (!g) { set(duelPatch({ blockType: 'plain', done: null, resume: null })); commit(); return }
        set({ blockType: type, blockGenre: null, done: null, resume: null, game: g, screen: 'game' })
        commit()
        return
      }
      if (type === 'showdown') {
        const sd = showdownRound({ n: SHOWDOWN_PICKS, pair: null, call: 'a', results: [], step: 'play' })
        set({ blockType: type, done: null, resume: null, showdown: sd, screen: 'showdown', pairN: ui.pairN + 1 })
        commit()
        return
      }
      if (type === 'finale') { set({ blockType: type, done: null, resume: null, screen: 'finale' }); return }
      if (type === 'plain') { set(duelPatch({ blockType: 'plain', blockGenre: null, done: null, resume: null })); commit(); return }
      if (type === 'knockout' && genre) {
        set({ blockType: type, blockGenre: genre, done: null, resume: null, cup: knockoutInit(S, T, genre, S.block > 12), screen: 'knockout', learned: '' })
        commit()
        return
      }
      // Everything else here is a run of duels; a knockout that can't run plays as Lightning.
      const runType: SpecialRun['type'] = type === 'deepdive' || type === 'creators' || type === 'series' ? type : 'lightning'
      const run: SpecialRun = {
        type: runType,
        left: runType === 'lightning' ? 10 : runType === 'deepdive' ? 6 : 5,
        picks: 0, t0: Date.now(),
        kind: runType === 'series' || (runType === 'creators' && S.format === 'series') ? 'tv' : undefined,
        genre: runType === 'deepdive' ? genre ?? undefined : undefined,
      }
      const pair = nextPair(S, T, specialFilter(run))
      if (!pair) { set(duelPatch({ blockType: 'plain', done: null, resume: null })); commit(); return }
      set({ special: run, blockType: runType, blockGenre: genre, done: null, resume: null, pair, pairN: ui.pairN + 1, screen: 'duel', learned: '' })
      commit()
    },
    endLightning() {
      if (!ui.special) return
      const events: PlayEvent[] = []
      set(finishSpecial(ui.special, true, events))
      commit(events)
    },
    koPick(side) {
      const C = ui.cup
      if (!C) return
      const m = C.rounds[C.r][C.mi]
      const events: PlayEvent[] = [{ kind: 'knockout', item_key: pairKey(m.a, m.b), payload: { a: m.a.id, b: m.b.id, chosen: m[side].id, axis: C.axis, pitch: m.pitch, round: C.r, block: S.block } }]
      const learned = knockoutPick(S, C, side)
      const result = knockoutNext(S, C)
      if (result) {
        note(S, `${C.name}: ${result.champion.title} wins`)
        // The winner gets a moment of its own before "Block done".
        const fan = { posters: result.contenders, championId: result.champion.id }
        set({ ...finishBlock('knockout', result.lines, events, { learned: '' }, `${result.champion.title} beat ${result.runnerUp.title} in the final`, fan), champion: { title: result.champion, runnerUp: result.runnerUp, name: C.name }, screen: 'champion' })
      } else set({ cup: { ...C }, learned })
      commit(events)
    },
    koUnseen(side) {
      const C = ui.cup
      if (!C) return
      const gone = C.rounds[C.r][C.mi][side]
      const learned = knockoutUnseen(S, C, side)
      set({ cup: { ...C }, learned })
      commit([{ kind: 'unseen', item_key: gone.id, payload: { title: gone.id } }])
    },
    koContinue() { if (ui.cup) set({ cup: { ...ui.cup, step: 'match' } }) },
    championContinue: () => set({ champion: null, screen: 'blockDone' }),

    showdownPick(side) {
      const sd = ui.showdown
      if (!sd?.pair) return
      const p = sd.pair
      choose(S, p, side)
      countBlockPick(S, [p[side]], p[side === 'a' ? 'b' : 'a'], p.pitch)
      const results = [...sd.results, { a: p.a, b: p.b, chose: side, call: sd.call }]
      toast(side === sd.call ? 'Called it ✓' : 'Missed that one')
      const events: PlayEvent[] = [duelEvent('showdown', p, { chosen: p[side].id, called: p[sd.call].id })]
      if (results.length >= sd.n) {
        const hits = results.filter(r => r.chose === r.call).length
        S.showdownScore = hits
        S.showdownN = results.length
        note(S, `Final round: called ${hits} of ${results.length}`)
        events.push({ kind: 'block_done', item_key: `block:${S.block}`, payload: { block: S.block, type: 'showdown', hits } })
        S.block++
        S.blockPicks = 0; S.blockTally = {}; S.blockChosen = []; S.blockPasses = 0
        set({ showdown: { ...sd, pair: null, results, step: 'summary' } })
      } else set({ showdown: showdownRound({ ...sd, results }), pairN: ui.pairN + 1 })
      commit(events)
    },
    finishSeason() {
      if (S.block <= SEASON_LENGTH) S.block = SEASON_LENGTH + 1
      note(S, 'Season 1 complete')
      set({ screen: 'tonight', resume: null })
      commit([{ kind: 'season_done', payload: { showdown: S.showdownScore ?? null } }])
    },

    blindWatch(yes) {
      const g = ui.game, b = g?.blind
      if (!g || !b) return
      const t = b.deck[b.i]
      learnFromRating(S, t, yes ? 0.5 : -0.5, 0.4)
      if (g.inPath && yes) countBlockPick(S, [t], null, false)
      set({ game: { ...g, blind: { ...b, step: 'name', yes: yes ? [...b.yes, t] : b.yes, no: yes ? b.no : [...b.no, t] } } })
      commit([{ kind: 'blind_watch', item_key: t.id, payload: { title: t.id, would_watch: yes } }])
    },
    blindName(choice) {
      const g = ui.game, b = g?.blind
      if (!g || !b) return
      const t = b.deck[b.i], correct = choice.id === t.id
      set({ game: { ...g, blind: { ...b, step: 'reveal', named: b.named + (correct ? 1 : 0), last: { correct, chosen: choice.id } } } })
      commit([{ kind: 'blind_name', item_key: t.id, payload: { title: t.id, guessed: choice.id, correct } }])
    },
    blindNext() {
      const g = ui.game, b = g?.blind
      if (!g || !b) return
      if (b.i + 1 < b.deck.length) { set({ game: { ...g, blind: { ...b, i: b.i + 1, step: 'watch', opts: options(T, b.deck[b.i + 1]), last: null } } }); return }
      // Lesson: what the stories they'd watch have in common, versus the ones they wouldn't.
      if (g.inPath) for (const y of b.yes) for (const n of b.no) tallyPick(S, y, n)
      const lean = g.inPath ? blockLean(S, false)?.replace('This block you kept picking the', 'Without the posters, you said yes to the') : null
      const n = b.deck.length
      finishGame(g, {
        big: `You named ${b.named} of ${n}`, score: b.named, cleared: b.named >= Math.ceil(n / 2),
        headline: b.named === n ? 'A perfect read.' : b.named >= n / 2 ? 'You know your stories.' : 'Tricky without the names, right?',
        lines: [`You named *${b.named} of ${n}* from the plot alone.`, ...(lean ? [lean] : []), `You'd watch ${b.yes.length} of the ${n} stories.`],
        posters: b.deck,
      }, [])
    },
    otherGuess(choice, typed = false) {
      const g = ui.game, o = g?.other
      if (!g || !o) return
      const t = o.deck[o.i]
      if (choice.id === t.id) {
        const pts = otherPoints(o.clue)
        set({ game: { ...g, other: { ...o, step: 'reveal', points: o.points + pts, knewEarly: o.knewEarly + (o.clue <= 2 ? 1 : 0), last: { correct: true, points: pts } } } })
        commit([{ kind: 'other_guess', item_key: t.id, payload: { title: t.id, clue: o.clue, correct: true, typed } }])
        return
      }
      const wrong = [...o.wrong, choice.id]
      const out = o.clue >= 5
      set({ game: { ...g, other: out ? { ...o, wrong, step: 'reveal', last: { correct: false, points: 0 } } : { ...o, wrong, clue: o.clue + 1 } } })
      if (!out) toast('Not that one. Here\'s another clue.')
      commit([{ kind: 'other_guess', item_key: t.id, payload: { title: t.id, clue: o.clue, guessed: choice.id, correct: false, typed } }])
    },
    otherClue() {
      const g = ui.game, o = g?.other
      if (!g || !o) return
      set({ game: { ...g, other: o.clue >= 5 ? { ...o, step: 'reveal', last: { correct: false, points: 0 } } : { ...o, clue: o.clue + 1 } } })
    },
    otherSeen(v) {
      const g = ui.game, o = g?.other
      if (!g || !o) return
      const t = o.deck[o.i]
      ;(S.seenWith ??= {})[t.id] = v
      const events: PlayEvent[] = [{ kind: 'seen_with', item_key: t.id, payload: { title: t.id, seen: v } }]
      if (o.i + 1 < o.deck.length) {
        set({ game: { ...g, other: { ...o, i: o.i + 1, clue: 1, wrong: [], step: 'guess', opts: options(T, o.deck[o.i + 1]), last: null } } })
        commit(events)
        return
      }
      const max = o.deck.length * 5
      finishGame(g, {
        big: `${o.points} of ${max} points`, score: o.points, cleared: o.points >= Math.ceil(max / 2),
        headline: o.points >= max * 0.8 ? 'You know your side characters.' : o.points >= max / 2 ? 'Nicely done.' : 'The side characters kept their secrets.',
        lines: [`You scored *${o.points} of ${max}* points.`, `You named ${o.knewEarly} of ${o.deck.length} on the first two clues.`],
        posters: o.deck,
      }, events)
    },
    hiloPick(guess) {
      const g = ui.game, h = g?.hilo
      if (!g || !h || h.step !== 'guess') return
      const mode = LEVELS.hilo[g.level ?? 0].mode ?? 'rating'
      const correct = (hiloValue(h.b, mode) > hiloValue(h.a, mode)) === (guess === 'higher')
      set({ game: { ...g, hilo: { ...h, step: 'reveal', streak: h.streak + (correct ? 1 : 0), last: { correct, guess } } } })
      commit([{ kind: 'hilo', item_key: `${h.a.id}|${h.b.id}`, payload: { known: h.a.id, challenger: h.b.id, guess, correct, mode } }])
    },
    hiloNext() {
      const g = ui.game, h = g?.hilo
      if (!g || !h) return
      const lv = LEVELS.hilo[g.level ?? 0]
      // The challenger becomes the known one; a new challenger arrives.
      const nxt = h.last?.correct && h.streak < h.target ? hiloChallenger(S, T, lv, h.b) : null
      if (nxt) {
        markServed(S, 'hilo', nxt.id)
        set({ game: { ...g, hilo: { ...h, a: h.b, b: nxt, step: 'guess', last: null, seen: [...h.seen, nxt] } } })
        return
      }
      const cleared = h.streak >= h.target
      finishGame(g, {
        big: `${h.streak} in a row`, score: h.streak, cleared,
        headline: cleared ? 'Level cleared.' : h.streak >= 3 ? 'Good run.' : 'The crowd surprised you.',
        lines: [cleared ? `*${h.streak} in a row*. Level cleared.` : `*${h.streak} in a row*. ${h.target} clears the level.`],
        posters: h.seen.slice(0, 8),
      }, [])
    },
    openUnlock(id) {
      if (id === 'picks') set({ screen: 'tonight', resume: 'blockDone' })
      else startGame(id)
    },

    reactToPick(t, r) {
      reactToPickBrain(S, t, r)
      commit([{ kind: 'pick_reaction', item_key: t.id, payload: { title: t.id, reaction: r } }])
    },
    toggleEditing: () => set({ editing: !ui.editing }),
    setScale(a, v) {
      setScaleBrain(S, a, v)
      toast('Updated. Your picks follow.')
      commit([{ kind: 'slider', payload: { scale: a, value: v } }])
    },

    startGame,
    beginGame() {
      const g = ui.game
      if (!g) return
      const lv = (S.games[g.id] ??= { level: 0, plays: 0 }).level
      if (g.id === 'blind' || g.id === 'other' || g.id === 'hilo') {
        const run = initGame(g.id, Math.min(lv, 4), false)
        if (run) set({ game: { ...run, k0: g.k0 } })
        commit()
        return
      }
      if (g.id === 'bet') {
        const target = lv === 0 ? 3 : lv < 4 ? 4 : 5
        const picked = new Set(S.log.filter(l => l.startsWith('Picked ')).map(l => l.slice(7).split(' over ')[0]))
        const done = new Set(S.betHistory.map(x => x.id))
        const okKind = (t: Title) => lv >= 2 || t.type === 'movie' || S.format === 'series'
        let pool = T.filter(t => allowedForGames(S, t) && !done.has(t.id) && !S.unseen.includes(t.id) && okKind(t))
        pool = lv >= 3
          ? shuffle(pool.filter(t => t.pop < 0.65)).concat(shuffle(pool.filter(t => t.pop >= 0.65)))
          : [...shuffle(pool.filter(t => picked.has(t.title))), ...pool.filter(t => !picked.has(t.title)).sort((x, y) => y.pop - x.pop)]
        set({ game: betAdvance({ ...g, phase: 'play', bet: { target, wtw: 0, you: 0, played: 0, hits: 0, skips: 0, queue: pool, cur: null, guess: null, step: 'rate', res: null } }) })
      } else {
        set({ game: mindAdvance({ ...g, phase: 'play', mind: { n: 8 + Math.min(4, lv * 2), i: 0, right: 0, step: 'guess', pair: null, guess: 'a', sure: false } }) })
      }
      commit()
    },
    betRate(r) {
      const g = ui.game, b = g?.bet
      if (!g || !b?.cur || !b.guess) return
      const { kind, biasNote } = settleBet(S, b.cur, b.guess, r)
      set({ game: { ...g, bet: {
        ...b, played: b.played + 1, step: 'result',
        wtw: b.wtw + (kind === 'wtw' ? 1 : 0), hits: b.hits + (kind === 'wtw' ? 1 : 0), you: b.you + (kind === 'you' ? 1 : 0),
        res: { pred: b.guess.pred, r, kind, note: biasNote },
      } } })
      commit([{ kind: 'bet', item_key: b.cur.id, payload: { title: b.cur.id, predicted: b.guess.pred, rated: r } }])
    },
    betUnseen() {
      const g = ui.game, b = g?.bet
      if (!g || !b?.cur) return
      if (!S.unseen.includes(b.cur.id)) S.unseen.push(b.cur.id)
      note(S, `The Bet: hasn't seen ${b.cur.title}. Skipped, no points`)
      const ev: PlayEvent = { kind: 'unseen', item_key: b.cur.id, payload: { title: b.cur.id, game: 'bet' } }
      set({ game: betAdvance({ ...g, bet: { ...b, skips: b.skips + 1 } }) })
      commit([ev])
    },
    betNext() { if (ui.game) { set({ game: betAdvance(ui.game) }); commit() } },
    mindReveal() { if (ui.game?.mind) set({ game: { ...ui.game, mind: { ...ui.game.mind, step: 'shown' } } }) },
    mindAnswer(right) {
      const g = ui.game, M = g?.mind
      if (!g || !M?.pair) return
      const side = right ? M.guess : M.guess === 'a' ? 'b' : 'a'
      choose(S, M.pair, side)
      if (S.log[0]) S.log[0] = `Mind Reader: ${right ? 'read right' : 'misread'}. ${S.log[0]}`
      toast(right ? 'Called it' : 'Noted. Adjusting.')
      const events = [duelEvent('mind_reader', M.pair, { chosen: M.pair[side].id, guessed: M.pair[M.guess].id, right })]
      set({ game: mindAdvance({ ...g, mind: { ...M, i: M.i + 1, right: M.right + (right ? 1 : 0) } }) })
      commit(events)
    },
    mindSkip() {
      const g = ui.game
      if (!g?.mind) return
      note(S, 'Mind Reader: skipped a pair')
      set({ game: mindAdvance(g) })
      commit()
    },
    exitGame: () => set({ game: null, screen: 'games' }),
    backToLobby: () => set({ game: null, screen: 'games' }),
  }

  if (!ready) return <AppShell><div className="phone"><div className="screen"><div className="loading">Loading…</div></div></div></AppShell>

  // Each bucket looks like itself: the arcade for games, an accent per special block.
  const arcade = ui.screen === 'games' || ui.screen === 'game'
  const specialOn = !arcade && ui.blockType !== 'plain' && ['blockIntro', 'duel', 'knockout', 'champion'].includes(ui.screen)
  const accent = arcade
    ? (ui.screen === 'game' && ui.game ? GAMES.find(g => g.id === ui.game!.id)!.acc : '#8f7bff')
    : BLOCKS[ui.blockType].accent
  if (introOn && !S.sel) {
    return (
      <AppShell>
        <IntroVoice text={GAMES_INTRO_MESSAGE} src={GAMES_INTRO_AUDIO_SRC} onPlay={() => setIntroOn(false)} />
      </AppShell>
    )
  }

  // The app's own frame: gradient and particles (2026-10-20). "Behind the
  // curtain" (Curtain.tsx) waits for a desktop layout; it isn't part of the phone app.
  return (
    <AppShell>
      <div className={`phone${arcade ? ' arcade' : ''}${specialOn ? ` special special-${ui.blockType}` : ''}`} style={{ ['--gacc' as string]: accent }}>
        <Screens ctl={ctl} />
        {ui.confirm && <Confirm ctl={ctl} />}
        <div className={`toast${ui.toast ? ' show' : ''}${ui.toastUndo ? ' has-undo' : ''}`} role="status" aria-live="polite">
          <span>{ui.toast}</span>{ui.toastUndo && <button type="button" onClick={ctl.undoToast}>Undo</button>}
        </div>
      </div>
      {leaving && <RouteLoading label="Loading" overlay />}
    </AppShell>
  )
}

/** "Are you sure?" for leaving the season early and for starting over. */
function Confirm({ ctl }: { ctl: Ctl }) {
  const skip = ctl.ui.confirm === 'skip'
  const close = ctl.closeConfirm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <>
      <div className="sheet-bg" onClick={ctl.closeConfirm} />
      <div className="sheet confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-h">
        <h3 id="confirm-h">{skip ? 'Skip for now?' : 'Start over?'}</h3>
        {skip ? (
          <p>I don&apos;t know you well enough yet, so your recommendations might not be spot on. You can always come back and play from the menu.</p>
        ) : (
          <p>This clears your taste calibration and takes you back to choosing genres. Your watchlist stays.</p>
        )}
        <button className="cta" autoFocus onClick={ctl.closeConfirm}>{skip ? 'Keep Playing' : 'Cancel'}</button>
        <button className="opt" onClick={skip ? ctl.confirmSkip : ctl.confirmRestart}>{skip ? 'Skip' : 'Start over'}</button>
      </div>
    </>
  )
}
