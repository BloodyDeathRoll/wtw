import type { SaveSource } from '../lib/watchlist'
import type { GameGenre } from '../lib/genres'
import type { Scale } from '../lib/scales'
import type { Format, Huh, HuhAnswer, Hunch, Pair, PickReaction, PlayState, Title, UnlockId } from '../lib/brain'
import type { BlockType, Cup, SpecialType } from '../lib/blocks'

export type Screen =
  | 'intro' | 'setup' | 'duel' | 'hunch' | 'huh'
  | 'blockIntro' | 'knockout' | 'champion' | 'blockDone'
  | 'path' | 'showdown' | 'finale'
  | 'tonight' | 'hub' | 'games' | 'game' | 'stub' | 'watchlist'

/** A special block made of ordinary duels (everything but Knockout). */
export interface SpecialRun {
  type: Exclude<SpecialType, 'knockout'>
  left: number
  picks: number
  t0: number
  genre?: GameGenre
  kind?: 'movie' | 'tv'
}

export interface Summary { headline: string; lines: string[]; champion?: Title; runnerUp?: Title; big?: string }

/** The "Block N done" screen. */
export interface BlockDone {
  block: number
  type: BlockType
  /** The lesson: first line is the headline. `*word*` marks words to highlight. */
  lines: string[]
  /** Titles for the poster fan: what was chosen (Knockout: every contender). */
  posters: Title[]
  /** Knockout: which poster is the champion. */
  championId?: string
  /** The small label over the title, e.g. "🏆 Drama Knockout". */
  label: string
  /** A fact about the block itself (e.g. "10 picks in 23 seconds"), not a lesson. */
  stat?: string
  champion?: Title
  unlocked: UnlockId | null
  next: BlockType
  nextGenre: GameGenre | null
}

export interface ShowdownRun {
  n: number
  pair: Pair | null
  /** The sealed call for the pair on screen. */
  call: 'a' | 'b'
  results: { a: Title; b: Title; chose: 'a' | 'b'; call: 'a' | 'b' }[]
  step: 'play' | 'summary'
}

/** The Knockout winner's moment, between the final and "Block done". */
export interface Champion { title: Title; runnerUp: Title; name: string }

export interface BetRun {
  target: number; wtw: number; you: number; played: number; hits: number; skips: number
  queue: Title[]; cur: Title | null; guess: { pred: number; raw: number } | null
  step: 'rate' | 'result'
  res: { pred: number; r: number; kind: 'wtw' | 'you'; note: string } | null
}

export interface MindRun {
  n: number; i: number; right: number
  step: 'guess' | 'shown'
  pair: Pair | null; guess: 'a' | 'b'; sure: boolean
}

export type GameId = 'bet' | 'mind' | 'blind' | 'other' | 'hilo'

/** Blind Taste Test: plot → would you watch it? → which one is it? → reveal. */
export interface BlindRun {
  deck: Title[]; i: number
  step: 'watch' | 'name' | 'reveal'
  opts: Title[]
  yes: Title[]; no: Title[]
  named: number
  last: { correct: boolean; chosen: string } | null
}

/** The Other Side of the Story: clues one by one, guess from four, then "have you seen it?". */
export interface OtherRun {
  deck: Title[]; i: number
  clue: number                      // clues shown, 1–5
  opts: Title[]; wrong: string[]
  step: 'guess' | 'reveal'
  points: number
  last: { correct: boolean; points: number } | null
  knewEarly: number                 // named by clue 2
}

/**
 * Higher or Lower, the classic format: `a`'s number is shown; is `b`'s higher
 * or lower? Right: `b` becomes the known one and a new challenger arrives.
 */
export interface HiloRun {
  a: Title; b: Title
  streak: number; target: number
  step: 'guess' | 'reveal'
  last: { correct: boolean; guess: 'higher' | 'lower' } | null
  seen: Title[]
}

export interface GameRun {
  id: GameId
  phase: 'intro' | 'play' | 'over'
  k0: number
  /** Played as a season step (level 1, closes like a block) rather than from Games. */
  inPath?: boolean
  /** The level being played (0-based). */
  level?: number
  bet?: BetRun
  mind?: MindRun
  blind?: BlindRun
  other?: OtherRun
  hilo?: HiloRun
  summary?: Summary
  newLevel?: string | null
}

export interface UI {
  screen: Screen
  pair: Pair | null
  /** Bumped on every new pair so the duel's pick animation resets. */
  pairN: number
  learned: string
  hunch: Hunch | null
  huh: Huh | null
  /** The block on screen right now (a skipped special plays as 'plain'). */
  blockType: BlockType
  blockGenre: GameGenre | null
  special: SpecialRun | null
  cup: Cup | null
  champion: Champion | null
  done: BlockDone | null
  /** The training screen to return to after visiting picks, games or My taste. */
  resume: Screen | null
  /** Step 14: five sealed calls, then the score. */
  showdown: ShowdownRun | null
  game: GameRun | null
  menu: boolean
  toast: string
  /** The toast offers Undo (a watchlist save). */
  toastUndo: boolean
  stub: 'settings' | null
  editing: boolean
  curtain: boolean
}

export interface Ctl {
  S: PlayState
  T: Title[]
  ui: UI
  firstName: string | null
  saveNote: string
  // navigation
  go(dest: 'tonight' | 'duel' | 'games' | 'hub' | 'watchlist' | 'settings'): void
  setMenu(open: boolean): void
  toggleCurtain(): void
  // setup
  startSetup(): void
  setFormat(f: Format): void
  rateGenre(g: GameGenre, r: 'love' | 'like' | 'never'): void
  finishSetup(): void
  // duel
  pick(side: 'a' | 'b'): void
  unseen(side: 'a' | 'b'): void
  both(): void
  neither(): void
  skip(): void
  // in-block questions
  answerHunch(v: 'yes' | 'sort' | 'no'): void
  answerHuh(v: HuhAnswer): void
  // blocks
  startBlock(): void
  endLightning(): void
  koPick(side: 'a' | 'b'): void
  koUnseen(side: 'a' | 'b'): void
  koContinue(): void
  championContinue(): void
  // season
  openPath(): void
  pathContinue(): void
  showdownPick(side: 'a' | 'b'): void
  finishSeason(): void
  // path games and the same games in Games
  blindWatch(yes: boolean): void
  blindName(t: Title): void
  blindNext(): void
  /** `typed`: named from memory rather than picked from the four answers — a stronger sign of having seen it. */
  otherGuess(t: Title, typed?: boolean): void
  otherClue(): void
  otherSeen(v: 'me' | 'kids' | 'both' | 'no'): void
  hiloPick(guess: 'higher' | 'lower'): void
  hiloNext(): void
  openUnlock(id: UnlockId): void
  // picks
  reactToPick(t: Title, r: PickReaction): void
  // profile
  toggleEditing(): void
  setScale(a: Scale, v: number): void
  // games
  startGame(id: GameId): void
  beginGame(): void
  betRate(r: number): void
  betUnseen(): void
  betNext(): void
  mindReveal(): void
  mindAnswer(right: boolean): void
  mindSkip(): void
  exitGame(): void
  backToLobby(): void
  toast(msg: string): void
  /** Saved on this device's watchlist (shared with the live app). */
  isSaved(id: string): boolean
  /** Save or unsave a title from wherever it shows; a save counts as a taste signal. */
  toggleSave(t: Title, source: SaveSource): void
  undoToast(): void
  /** Remove by id (also titles saved in the live app, which the games don't know). */
  removeSaved(id: string, title: string): void
}
