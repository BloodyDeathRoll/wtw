'use client'
/**
 * The new first run's steps (P2-U2 … U4): genres → rating cards → the screen before the picks → quick picks →
 * "It's Showtime". Routing new users here is #247.
 *
 * Progress is the same play_state row as the games (`state.onboarding`), so coming back opens the step that was
 * left, on the next card. The card answers have their own queue to /api/onboarding/cards (../lib/card-queue.ts).
 * The picks go to play_events (`duel`, source 'onboarding') with the state. Moves between cards, pairs and steps use
 * the signed-off Flow motion (../lib/flow.ts). "It's Showtime" holds 3 s and makes the first feed (../lib/showtime.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/modules/session/components/AppShell'
import type { AppUser } from '@/modules/session/types'
import { readLocal, usePersistence } from '@/app/play/components/persist'
import type { Ctl } from '@/app/play/components/types'
import { freshState, prepareTitles, type PlayState, type Title } from '@/app/play/lib/brain'
import type { PlayEvent } from '@/app/play/lib/events'
import type { GameTitle } from '@/app/play/lib/scales'
import { savedIds, saveTitle, unsaveTitle, type SaveSource } from '@/app/play/lib/watchlist'
import type { SavedPlay } from '@/app/play/lib/server'
import OnboardingTop from './OnboardingTop'
import GenreStep from './GenreStep'
import { BetweenScreen, CardScreen, MessageScreen, SkipButton } from './CardsStep'
import { PairScreen, ShowtimeScreen, SkipSheet } from './PicksStep'
import { applyGenreStep, to13, type GenreAnswers } from '../lib/genre-step'
import {
  answer, blocked, endEarly, freshCards, lastUnseen, nextCard, shownCount,
  type CardsState, type Message, type Rating,
} from '../lib/cards'
import {
  cantDecide, haventSeen, loadPicks, pick, savePicks, startQuickPicks,
  type GenreAnswer, type QuickPicks, type Side,
} from '../lib/quick-picks'
import { fanOf, runShowtime } from '../lib/showtime'
import type { GameGenre } from '@/app/play/lib/genres'
import { furthest, readDevice, useCardQueue } from '../lib/card-queue'
import {
  CARD_PARTS, MESSAGE_PARTS, PAIR_PARTS, STEP_PARTS, afterPick, flowIn, flowOut, pickOut, preload, sideParts, type Part,
} from '../lib/flow'

type Step = NonNullable<NonNullable<PlayState['onboarding']>['step']>
type View = { kind: 'card'; t: Title; at: number; milestone: string | null } | { kind: 'message'; m: Message } | null

/** Taps during a motion are ignored (P2-U0 Flow), so a double tap counts once. */
const CARD_LOCK_MS = 500
/** A pick's motion runs ~1.2 s; a tap meanwhile is ignored. */
const PICK_LOCK_MS = 1200
/** The sheet closes in 220 ms. */
const SHEET_CLOSE_MS = 220

/** The 16 answers as the 13 the season's picker reads (Love 2 · Like 1 · Never −9; see genre-step.ts → to13). */
function answers13(a: GenreAnswers): Partial<Record<GameGenre, GenreAnswer>> {
  const out: Partial<Record<GameGenre, GenreAnswer>> = {}
  for (const [g, v] of Object.entries(to13(a)) as [GameGenre, number][]) if (v) out[g] = v >= 2 ? 'love' : v >= 1 ? 'like' : 'never'
  return out
}

const withOnboarding = (S: PlayState | null, patch: NonNullable<PlayState['onboarding']>): PlayState => {
  const base = S ?? freshState()
  return { ...base, onboarding: { ...base.onboarding, ...patch } }
}

export default function OnboardingApp({ user, saved, titles }: { user: AppUser; saved: SavedPlay; titles: GameTitle[] }) {
  const router = useRouter()
  /** The signed-out local demo (/onboarding?demo=1): nothing leaves this browser. */
  const demo = saved.mode === 'local'
  const { save, flushNow, status } = usePersistence(user.id, saved.mode, saved.version)
  const queue = useCardQueue(user.id, saved.mode === 'server')
  const T = useMemo(() => prepareTitles(titles), [titles])
  const byId = useMemo(() => new Map(T.map(t => [t.id, t])), [T])

  const SRef = useRef<PlayState | null>(saved.state)
  const [ready, setReady] = useState(saved.mode === 'server')
  const [step, setStep] = useState<Step>(saved.state?.onboarding?.step ?? 'genres')
  const [cards, setCards] = useState<CardsState>(saved.state?.onboarding?.cards ?? freshCards())
  const [answers16, setAnswers16] = useState<GenreAnswers>(saved.state?.onboarding?.genres16 ?? {})

  const viewFor = (c: CardsState, a: GenreAnswers): View => {
    const n = nextCard(c.i, a, byId)
    return n ? { kind: 'card', t: n.t, at: n.i, milestone: null } : null
  }
  const [view, setView] = useState<View>(() => viewFor(cards, answers16))

  // The quick picks: the 980 game titles minus anything a Never rules out (by the 16 and by the 13).
  const pool = useMemo(() => T.filter(t => !blocked(t, answers16)), [T, answers16])
  const [q, setQ] = useState<QuickPicks | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [sheet, setSheet] = useState<'closed' | 'open' | 'closing'>('closed')
  const [showtime, setShowtime] = useState<'wait' | 'slow' | 'failed'>('wait')
  const [tries, setTries] = useState(0)

  /** The picks as saved, or a fresh start seeded with the genre answers. */
  const picksFor = (S: PlayState | null, a: GenreAnswers): { q: QuickPicks; picked: string[] } => {
    const sv = S?.onboarding?.picks
    const back = sv && loadPicks(sv, byId)
    if (sv && back) return { q: back, picked: sv.picked }
    return { q: startQuickPicks(answers13(a), T.filter(t => !blocked(t, a))), picked: [] }
  }

  // After the first render: the signed-out demo's saved state, and the phone's copy of the cards (it can be
  // ahead of play_state when the app was closed between two saves). Nothing on the cards is ever undone.
  useEffect(() => {
    if (saved.mode === 'local') SRef.current = readLocal(user.id)
    const S = SRef.current
    const c = furthest(S?.onboarding?.cards, readDevice(user.id).cards) ?? freshCards()
    let s: Step = S?.onboarding?.step ?? 'genres'
    if (s === 'cards' && c.end) s = 'between'
    if (s === 'picks') {
      const p = picksFor(S, S?.onboarding?.genres16 ?? {})
      setQ(p.q)
      setPicked(p.picked)
      if (p.q.done) s = 'showtime'
    }
    if (s === 'showtime') setPicked(S?.onboarding?.picks?.picked ?? [])
    setStep(s)
    setAnswers16(S?.onboarding?.genres16 ?? {})
    setCards(c)
    setView(viewFor(c, S?.onboarding?.genres16 ?? {}))
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the first visit render
  }, [])

  // ── Motion ──
  const screenRef = useRef<HTMLDivElement>(null)
  const entering = useRef<Part[] | null>(null)
  const lockUntil = useRef(0)
  const locked = (ms = CARD_LOCK_MS) => {
    if (Date.now() < lockUntil.current) return true
    lockUntil.current = Date.now() + ms
    return false
  }
  const move = (parts: Part[], apply: () => void) => {
    flowOut(screenRef.current, parts)
    entering.current = parts
    apply()
  }
  useLayoutEffect(() => {
    if (!entering.current) return
    flowIn(screenRef.current, entering.current)
    entering.current = null
  }, [step, view, q])

  // Load the next pair's posters before it comes in (after a swap, the side's next is unknown until then).
  useEffect(() => { if (q?.pair) preload([q.pair.a.poster_path, q.pair.b.poster_path], 'w342') }, [q])

  // Load the next two cards' posters before they slide in.
  useEffect(() => {
    if (step !== 'cards' || view?.kind !== 'card') return
    const a = nextCard(view.at + 1, answers16, byId)
    const b = a && nextCard(a.i + 1, answers16, byId)
    preload([a?.t.poster_path, b?.t.poster_path])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answers16 only changes with the step
  }, [step, view, byId])

  // ── Saving ──
  const commit = (patch: NonNullable<PlayState['onboarding']>, events: PlayEvent[] = []) => {
    SRef.current = withOnboarding(SRef.current, patch)
    save(SRef.current, events)
  }
  const note = status === 'error' || queue.failed

  // ── The watchlist ribbon, share and their toast (the games' own, so the card is the game card) ──
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set())
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the device's list exists only in the browser (as PlayApp)
  useEffect(() => { setSavedSet(savedIds()) }, [])
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1900)
  }
  const ctl = {
    user,
    toast: showToast,
    isSaved: (id: string) => savedSet.has(id),
    toggleSave: (t: Title, from: SaveSource) => {
      if (savedSet.has(t.id)) {
        unsaveTitle(t.id)
        setSavedSet(prev => { const n = new Set(prev); n.delete(t.id); return n })
        showToast(`Removed ${t.title} from your watchlist`)
        return
      }
      saveTitle(t, from)
      setSavedSet(prev => new Set(prev).add(t.id))
      showToast(`${t.title} is on your watchlist`)
    },
  } as unknown as Ctl

  // ── Steps ──
  const startCards = async (answers: GenreAnswers) => {
    const S = applyGenreStep(SRef.current, answers)
    const c = freshCards()
    SRef.current = withOnboarding(S, { cards: c })
    save(SRef.current, [{ kind: 'onboarding_genres', payload: { genres16: answers } }])
    await flushNow()
    move(STEP_PARTS, () => { setAnswers16(answers); setCards(c); setView(viewFor(c, answers)); setStep('cards') })
  }

  const toBetween = (c: CardsState, events: PlayEvent[] = []) => {
    commit({ cards: c, step: 'between' }, events)
    void queue.flushNow()
    move(STEP_PARTS, () => { setCards(c); setStep('between') })
  }

  const onAnswer = (r: Rating | 'unseen') => {
    if (view?.kind !== 'card' || locked()) return
    const res = answer(cards, view.at, view.t.id, r, answers16, byId)
    queue.push(res.c, { id: view.t.id, r })
    const next = res.next
    if ('end' in next) { toBetween(res.c); return }
    commit({ cards: res.c })
    if ('message' in next) move(MESSAGE_PARTS, () => { setCards(res.c); setView({ kind: 'message', m: next.message }) })
    else move(CARD_PARTS, () => { setCards(res.c); setView({ kind: 'card', t: next.card, at: next.at, milestone: next.milestone }) })
  }

  const keepGoing = () => {
    if (locked()) return
    const v = viewFor(cards, answers16)
    if (!v) { toBetween({ ...cards, end: 'cap' }); return }
    move(MESSAGE_PARTS, () => setView(v))
  }

  const endCards = (where: 'skip' | 'message') => {
    if (locked()) return
    const c = endEarly(cards)
    queue.setCards(c)
    toBetween(c, [{ kind: where === 'skip' ? 'onboarding_skip' : 'onboarding_to_picks', payload: { where: 'cards', rated: c.rated.length, shown: shownCount(c) } }])
  }

  const toShowtime = (patch: NonNullable<PlayState['onboarding']>, events: PlayEvent[], motion: 'step' | 'none') => {
    commit({ ...patch, step: 'showtime', done_at: new Date().toISOString() }, events)
    const go = () => { setShowtime('wait'); setStep('showtime') }
    if (motion === 'step') move(STEP_PARTS, go)
    else go()
  }

  const startPicks = () => {
    if (locked()) return
    const p = picksFor(SRef.current, answers16)
    if (p.q.done) { toShowtime({ picks: savePicks(p.q, p.picked) }, [], 'step'); return }
    commit({ step: 'picks', picks: savePicks(p.q, p.picked) })
    move(STEP_PARTS, () => { setQ(p.q); setPicked(p.picked); setStep('picks') })
  }

  const onPick = (side: Side) => {
    if (!q?.pair || locked(PICK_LOCK_MS)) return
    const r = pick(q, side, pool)
    const nextPicked = [...picked, q.pair[side].id]
    const saved = { picks: savePicks(r.q, nextPicked) }
    pickOut(screenRef.current, side === 'a' ? 0 : 1, r.q.done)
    if (r.q.done) {
      entering.current = afterPick(STEP_PARTS, true)
      setPicked(nextPicked)
      toShowtime(saved, [r.event], 'none')
      return
    }
    commit(saved, [r.event])
    entering.current = afterPick(PAIR_PARTS, false)
    setQ(r.q)
    setPicked(nextPicked)
  }

  const onUnseen = (side: Side) => {
    if (!q?.pair || q.off[side] || locked()) return
    const r = haventSeen(q, side, pool)
    if (!r.event) return
    commit({ picks: savePicks(r.q, picked) }, [r.event])
    if (r.q.pair?.[side].id === q.pair[side].id) setQ(r.q)   // nothing similar left: only the button goes off
    else move(sideParts(side === 'a' ? 0 : 1), () => setQ(r.q))
  }

  const onCantDecide = () => {
    if (!q?.pair || locked()) return
    const r = cantDecide(q, pool)
    if (r.q.done) { setQ(r.q); toShowtime({ picks: savePicks(r.q, picked) }, [r.event], 'step'); return }
    commit({ picks: savePicks(r.q, picked) }, [r.event])
    move(PAIR_PARTS, () => setQ(r.q))
  }

  const closeSheet = (then?: () => void) => {
    setSheet('closing')
    setTimeout(() => { setSheet('closed'); then?.() }, SHEET_CLOSE_MS)
  }
  const skipPicks = () => closeSheet(() => {
    if (!q) return
    toShowtime({ picks: savePicks({ ...q, done: true }, picked) },
      [{ kind: 'onboarding_skip', payload: { where: 'picks', picks: q.picks, pairs: q.pairs } }], 'step')
  })

  // "It's Showtime": everything saved, then the first feed; it holds 3 s and opens the feed when both are done.
  useEffect(() => {
    if (step !== 'showtime' || !ready) return
    const feed = async () => {
      await flushNow()
      await queue.flushNow()
      if (demo) return
      const res = await fetch('/api/onboarding/finish', { method: 'POST' })
      if (!res.ok) throw new Error(`finish ${res.status}`)
    }
    return runShowtime(feed, {
      // Straight to the feed (P2-U0 part 6), not the home screen; the deep link the menu uses.
      ready: () => { if (!demo) router.replace('/?stage=recommendations') },
      slow: () => setShowtime('slow'),
      failed: () => setShowtime('failed'),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival (and per "Try again")
  }, [step, ready, tries])

  // ── Render ──
  const top = (left?: React.ReactNode) => <OnboardingTop user={user} left={left} />
  const skip = <SkipButton onSkip={() => endCards('skip')} />
  let screen: React.ReactNode = null
  if (!ready) screen = null
  else if (step === 'genres') screen = <GenreStep top={top()} onStart={startCards} screenRef={screenRef} />
  else if (step === 'cards' && view?.kind === 'card') {
    screen = <CardScreen top={top(skip)} ctl={ctl} t={view.t} rated={cards.rated.length} milestone={view.milestone}
      onAnswer={onAnswer} note={note} screenRef={screenRef} />
  } else if (step === 'cards' && view?.kind === 'message') {
    const fan = lastUnseen(cards).map(id => byId.get(id)).filter((t): t is Title => !!t)
    screen = <MessageScreen top={top(skip)} m={view.m} rated={cards.rated.length} fan={fan}
      onKeepGoing={keepGoing} onToPicks={() => endCards('message')} note={note} screenRef={screenRef} />
  } else if (step === 'cards' || step === 'between') {
    screen = <BetweenScreen top={top()} cards={cards} byId={byId} onStart={startPicks} note={note} screenRef={screenRef} />
  } else if (step === 'picks' && q?.pair) {
    screen = (
      <PairScreen top={top(<SkipButton onSkip={() => setSheet('open')} />)} ctl={ctl} pair={q.pair} picks={q.picks} off={q.off}
        note={q.note} onPick={onPick} onUnseen={onUnseen} onCantDecide={onCantDecide} saveFailed={note} screenRef={screenRef} />
    )
  } else {
    const loved = cards.rated.filter(r => r.r === 'loved').map(r => r.id)
    const fan = fanOf(picked, loved).map(id => byId.get(id)).filter((t): t is Title => !!t)
    screen = <ShowtimeScreen top={top()} fan={fan} state={showtime} screenRef={screenRef}
      onRetry={() => { setShowtime('wait'); setTries(n => n + 1) }} />
  }

  return (
    <AppShell>
      <div className="phone ob">
        {screen}
        {sheet !== 'closed' && <SkipSheet closing={sheet === 'closing'} onKeep={() => closeSheet()} onSkip={skipPicks} />}
        <div className={`toast${toast ? ' show' : ''}`} role="status" aria-live="polite"><span>{toast}</span></div>
      </div>
    </AppShell>
  )
}
