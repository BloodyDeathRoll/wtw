'use client'
/**
 * The rating cards' answers on their way to POST /api/onboarding/cards (P2-U3).
 *
 * "Keep every answer as it's given" (P2-U0 rules): each answer is written to this phone first (localStorage),
 * then sent in batches of up to 10, about a second after the last tap (never more than 4 s after the first
 * waiting one). An answer that didn't go stays on the phone and goes with the next one, or on the next visit.
 * Leaving the page sends what's waiting with keepalive.
 *
 * The card progress itself travels with it, so a visit after the app was closed mid-batch still opens on the
 * next card (play_state is saved too, but on its own timer).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_CARD_ANSWERS, shownCount, type CardAnswer, type CardsState } from './cards'

const key = (userId: string) => `wtw-ob-cards:${userId}`
const DEBOUNCE_MS = 1200
const MAX_WAIT_MS = 4000

export interface DeviceCards { cards: CardsState | null; pending: CardAnswer[] }

export function readDevice(userId: string): DeviceCards {
  try {
    const raw = localStorage.getItem(key(userId))
    if (raw) {
      const d = JSON.parse(raw) as Partial<DeviceCards>
      return { cards: d.cards ?? null, pending: Array.isArray(d.pending) ? d.pending : [] }
    }
  } catch { /* private mode or bad data: start empty */ }
  return { cards: null, pending: [] }
}

function writeDevice(userId: string, d: DeviceCards) {
  try { localStorage.setItem(key(userId), JSON.stringify(d)) } catch { /* private mode: nothing to keep */ }
}

/** The further of the two copies (the phone's, the account's): nothing on the cards is ever undone. */
export function furthest(a: CardsState | null | undefined, b: CardsState | null | undefined): CardsState | null {
  if (!a) return b ?? null
  if (!b) return a
  return shownCount(b) > shownCount(a) || (!!b.end && !a.end) ? b : a
}

/** `send: false` (the signed-out demo) keeps answers on the phone only. */
export function useCardQueue(userId: string, send: boolean) {
  const pending = useRef<CardAnswer[]>([])
  const cards = useRef<CardsState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstWaiting = useRef<number | null>(null)
  const sending = useRef<Promise<void> | null>(null)
  const [failed, setFailed] = useState(false)

  const persist = useCallback(() => writeDevice(userId, { cards: cards.current, pending: pending.current }), [userId])

  const flush = useCallback(async () => {
    timer.current = null
    firstWaiting.current = null
    if (!send) { pending.current = []; persist(); return }
    while (pending.current.length) {
      const batch = pending.current.slice(0, MAX_CARD_ANSWERS)
      try {
        const res = await fetch('/api/onboarding/cards', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: batch }),
        })
        if (!res.ok) throw new Error(`cards ${res.status}`)
      } catch (err) {
        console.warn('[onboarding] card answers not saved yet', err)
        setFailed(true)
        return   // kept on the phone; the next answer (or visit) retries
      }
      pending.current = pending.current.slice(batch.length)
      persist()
      setFailed(false)
    }
  }, [send, persist])

  const run = useCallback(() => {
    const prev = sending.current ?? Promise.resolve()
    const next = prev.then(flush)
    sending.current = next.finally(() => { if (sending.current === next) sending.current = null })
    return next
  }, [flush])

  /** Record one answer (and the progress it leads to): on the phone now, to the account soon. */
  const push = useCallback((c: CardsState, a: CardAnswer) => {
    cards.current = c
    pending.current = [...pending.current, a]
    persist()
    if (timer.current) clearTimeout(timer.current)
    const now = Date.now()
    firstWaiting.current ??= now
    const wait = pending.current.length >= MAX_CARD_ANSWERS ? 0 : Math.max(0, Math.min(DEBOUNCE_MS, firstWaiting.current + MAX_WAIT_MS - now))
    timer.current = setTimeout(() => { void run() }, wait)
  }, [persist, run])

  /** Progress without an answer (Skip, "Go to quick picks"): kept on the phone with the rest. */
  const setCards = useCallback((c: CardsState) => { cards.current = c; persist() }, [persist])

  /** Send what's waiting now (the cards ended): resolves when it's done or has failed. */
  const flushNow = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    await run()
  }, [run])

  // On the first visit back: what the phone kept from last time goes first.
  useEffect(() => {
    const d = readDevice(userId)
    cards.current = d.cards
    pending.current = d.pending
    if (d.pending.length) void run()
  }, [userId, run])

  // Leaving the page: send what's waiting; keepalive lets it outlive the tab. The phone copy stays until a
  // normal send confirms it, so a lost keepalive is retried next visit (the server writes a repeat once).
  useEffect(() => {
    if (!send) return
    const onHide = () => {
      if (!pending.current.length) return
      void fetch('/api/onboarding/cards', {
        method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: pending.current.slice(0, MAX_CARD_ANSWERS) }),
      }).catch(() => {})
    }
    const onVis = () => { if (document.visibilityState === 'hidden') onHide() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide) }
  }, [send])

  return { push, setCards, flushNow, failed }
}
