/**
 * #453: a tab screen's chip is kept for the visit (NAV_HISTORY), so coming back to the Watchlist or Seen lands on the
 * list you had picked, not on All.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

let navHistory = true
vi.mock('@/lib/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/flags')>()), navHistoryEnabled: () => navHistory }))

import { useTabChoice } from '@/modules/session/tab-place'

beforeEach(() => {
  navHistory = true
  sessionStorage.clear()
})
afterEach(() => sessionStorage.clear())

describe('useTabChoice', () => {
  it('a chip picked, the screen left and opened again: the same chip', () => {
    const first = renderHook(() => useTabChoice<string>('u1:watchlist:filter', 'all'))
    expect(first.result.current[0]).toBe('all')
    act(() => first.result.current[1]('movies'))
    expect(first.result.current[0]).toBe('movies')
    first.unmount()
    const again = renderHook(() => useTabChoice<string>('u1:watchlist:filter', 'all'))
    expect(again.result.current[0]).toBe('movies')
    // Another account's screen has its own.
    expect(renderHook(() => useTabChoice<string>('u2:watchlist:filter', 'all')).result.current[0]).toBe('all')
  })

  it('a saved value the screen no longer offers opens on the usual chip', () => {
    sessionStorage.setItem('wtw:choice:u1:seen:kind', 'shorts')
    const ok = (v: string) => ['all', 'movie', 'tv'].includes(v)
    expect(renderHook(() => useTabChoice<string>('u1:seen:kind', 'all', ok)).result.current[0]).toBe('all')
  })

  it('NAV_HISTORY off: nothing is kept', () => {
    navHistory = false
    const first = renderHook(() => useTabChoice<string>('u1:seen:chip', 'loved'))
    act(() => first.result.current[1]('liked'))
    first.unmount()
    expect(sessionStorage.length).toBe(0)
    expect(renderHook(() => useTabChoice<string>('u1:seen:chip', 'loved')).result.current[0]).toBe('loved')
  })

  it('a new key (another account, or the user arriving late) reads its own, or opens on the usual chip', () => {
    sessionStorage.setItem('wtw:choice:u1:seen:chip', 'liked')
    const h = renderHook(({ k }) => useTabChoice<string>(k, 'loved'), { initialProps: { k: '' } })
    expect(h.result.current[0]).toBe('loved')
    h.rerender({ k: 'u1:seen:chip' })
    expect(h.result.current[0]).toBe('liked')
    h.rerender({ k: 'u2:seen:chip' })
    expect(h.result.current[0]).toBe('loved')
  })

  it('an empty key (For you, not the Watchlist) reads and keeps nothing', () => {
    const h = renderHook(() => useTabChoice<string>('', 'all'))
    act(() => h.result.current[1]('movies'))
    expect(h.result.current[0]).toBe('movies')
    expect(sessionStorage.length).toBe(0)
  })
})
