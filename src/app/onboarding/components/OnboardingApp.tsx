'use client'
/**
 * The new first run's steps (P2-U2 … U4): genres → rating cards → the screen before the picks → quick picks →
 * "It's Showtime". Built so far: genres, cards and the screen before the picks; the quick picks are #245.
 *
 * Progress is the same play_state row as the games (`state.onboarding`), so coming back opens the step that was
 * left, on the next card. The card answers have their own queue to /api/onboarding/cards (../lib/card-queue.ts).
 * Moves between cards and steps use the signed-off Flow motion (../lib/flow.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { applyGenreStep, type GenreAnswers } from '../lib/genre-step'
import {
  answer, endEarly, freshCards, lastUnseen, nextCard, shownCount,
  type CardsState, type Message, type Rating,
} from '../lib/cards'
import { furthest, readDevice, useCardQueue } from '../lib/card-queue'
import { CARD_PARTS, MESSAGE_PARTS, STEP_PARTS, flowIn, flowOut, preload, type Part } from '../lib/flow'

type Step = NonNullable<NonNullable<PlayState['onboarding']>['step']>
type View = { kind: 'card'; t: Title; at: number; milestone: string | null } | { kind: 'message'; m: Message } | null

/** Taps during a motion are ignored (P2-U0 Flow), so a double tap counts once. */
const CARD_LOCK_MS = 500

const withOnboarding = (S: PlayState | null, patch: NonNullable<PlayState['onboarding']>): PlayState => {
  const base = S ?? freshState()
  return { ...base, onboarding: { ...base.onboarding, ...patch } }
}

export default function OnboardingApp({ user, saved, titles }: { user: AppUser; saved: SavedPlay; titles: GameTitle[] }) {
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

  // After the first render: the signed-out demo's saved state, and the phone's copy of the cards (it can be
  // ahead of play_state when the app was closed between two saves). Nothing on the cards is ever undone.
  useEffect(() => {
    if (saved.mode === 'local') SRef.current = readLocal(user.id)
    const S = SRef.current
    const c = furthest(S?.onboarding?.cards, readDevice(user.id).cards) ?? freshCards()
    let s: Step = S?.onboarding?.step ?? 'genres'
    if (s === 'cards' && c.end) s = 'between'
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
  const locked = () => {
    if (Date.now() < lockUntil.current) return true
    lockUntil.current = Date.now() + CARD_LOCK_MS
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
  }, [step, view])

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

  const startPicks = () => {
    if (locked()) return
    commit({ step: 'picks' })
    move(STEP_PARTS, () => setStep('picks'))
  }

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
  } else {
    screen = (
      <div className="screen game-screen" ref={screenRef}>
        {top()}
        <div className="learn va2 between"><div className="bmid">
          <h2>Quick picks</h2>
          <p>Coming next (#245).</p>
        </div></div>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="phone ob">
        {screen}
        <div className={`toast${toast ? ' show' : ''}`} role="status" aria-live="polite"><span>{toast}</span></div>
      </div>
    </AppShell>
  )
}
