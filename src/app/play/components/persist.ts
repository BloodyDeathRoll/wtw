'use client'
/**
 * Saving progress. The state goes to play_state through /api/play/state and
 * every answer to play_events through /api/play/events. Until migration 0024
 * is run, the server answers 503 `not_set_up` and progress is kept in this
 * browser instead, so the games can be tried before the tables exist.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayState } from '../lib/brain'
import { MAX_EVENTS_PER_REQUEST, type PlayEvent } from '../lib/events'

export type SaveMode = 'server' | 'local'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'local' | 'conflict' | 'error'

const localKey = (userId: string) => `wtw-play:${userId}`
const MAX_WAIT_MS = 4000

export function readLocal(userId: string): PlayState | null {
  try {
    const raw = localStorage.getItem(localKey(userId))
    return raw ? (JSON.parse(raw) as PlayState) : null
  } catch {
    return null
  }
}

export function usePersistence(userId: string, initialMode: SaveMode, initialVersion: number) {
  const mode = useRef<SaveMode>(initialMode)
  const version = useRef(initialVersion)
  const queue = useRef<PlayEvent[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<PlayState | null>(null)
  /** The save in progress, if any (flushNow waits for it). */
  const inFlight = useRef<Promise<void>>(Promise.resolve())
  const [status, setStatus] = useState<SaveStatus>(initialMode === 'local' ? 'local' : 'idle')

  const goLocal = useCallback(() => {
    mode.current = 'local'
    setStatus('local')
  }, [])

  const flush = useCallback(async () => {
    timer.current = null
    const state = latest.current
    if (!state) return
    if (mode.current === 'local') {
      try { localStorage.setItem(localKey(userId), JSON.stringify(state)) } catch { /* private mode: nothing to do */ }
      queue.current = []
      return
    }
    setStatus('saving')
    try {
      while (queue.current.length) {
        const batch = queue.current.slice(0, MAX_EVENTS_PER_REQUEST)
        const res = await fetch('/api/play/events', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: batch }),
        })
        if (res.status === 503) { goLocal(); return flush() }
        if (!res.ok) throw new Error(`events ${res.status}`)
        queue.current = queue.current.slice(batch.length)
      }
      const res = await fetch('/api/play/state', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, version: version.current }),
      })
      if (res.status === 503) { goLocal(); return flush() }
      if (res.status === 409) { setStatus('conflict'); return }
      if (!res.ok) throw new Error(`state ${res.status}`)
      version.current = ((await res.json()) as { version: number }).version
      setStatus('saved')
    } catch (err) {
      console.warn('[play] save failed', err)
      setStatus('error')
      // Keep the queue; the next answer retries it.
    }
  }, [userId, goLocal])

  /**
   * Save soon, with any new events. Debounced so a burst of taps is one
   * write — but never postponed past MAX_WAIT_MS, so a fast Lightning round
   * can't keep pushing the save back until the tab is closed.
   */
  const firstPending = useRef<number | null>(null)
  const save = useCallback((state: PlayState, events: PlayEvent[] = []) => {
    latest.current = state
    queue.current.push(...events)
    if (timer.current) clearTimeout(timer.current)
    const now = Date.now()
    firstPending.current ??= now
    const wait = Math.max(0, Math.min(900, firstPending.current + MAX_WAIT_MS - now))
    timer.current = setTimeout(() => { firstPending.current = null; inFlight.current = flush() }, wait)
  }, [flush])

  /**
   * Write what's pending now, e.g. before navigating to another page of the
   * app (no pagehide there). Also waits out a save already on the wire.
   */
  const flushNow = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      firstPending.current = null
      inFlight.current = flush()
    }
    await inFlight.current
  }, [flush])

  // Leaving the page: write what's pending. keepalive lets it outlive the tab.
  useEffect(() => {
    const onHide = () => {
      if (!timer.current || !latest.current) return
      clearTimeout(timer.current)
      timer.current = null
      if (mode.current === 'local') {
        try { localStorage.setItem(localKey(userId), JSON.stringify(latest.current)) } catch { /* ignore */ }
        return
      }
      if (queue.current.length) {
        void fetch('/api/play/events', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: queue.current.slice(0, MAX_EVENTS_PER_REQUEST) }) })
      }
      void fetch('/api/play/state', { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: latest.current, version: version.current }) })
    }
    const onVis = () => { if (document.visibilityState === 'hidden') onHide() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
    }
  }, [userId])

  return { save, flushNow, status }
}
