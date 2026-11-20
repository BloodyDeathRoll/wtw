/**
 * v3 N2 (YOU.md DEC-2): every tab remembers where you were (src/modules/session/tab-place.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useTabPlace } from '@/modules/session/tab-place'

/** A tab screen's scroller as jsdom can't lay it out: its height, content height and position are set by hand. */
function scroller(contentHeight: number) {
  const el = document.createElement('div')
  el.setAttribute('data-tab-scroll', '')
  let top = 0
  let content = contentHeight
  Object.defineProperty(el, 'clientHeight', { get: () => 600 })
  Object.defineProperty(el, 'scrollHeight', { get: () => content })
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, content - 600)) } })
  el.getClientRects = () => [{}] as unknown as DOMRectList
  document.body.appendChild(el)
  return { el, grow: (h: number) => { content = h }, scrollTo: (v: number) => { el.scrollTop = v; el.dispatchEvent(new Event('scroll')) } }
}

function Screen({ k }: { k: string | null }) {
  useTabPlace(k)
  return null
}
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await act(async () => { vi.advanceTimersByTime(20) }) }

beforeEach(() => {
  vi.useFakeTimers()
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useTabPlace', () => {
  it('leave a tab and come back: the same place', async () => {
    const a = scroller(3000)
    const { rerender } = render(<Screen k="watchlist" />)
    a.scrollTo(900)
    a.el.remove()
    rerender(<Screen k="games" />)
    const b = scroller(3000)
    rerender(<Screen k="watchlist" />)
    await frames()
    expect(b.el.scrollTop).toBe(900)
  })

  it('a list that grows as it scrolls is followed down, a page at a time, to the place', async () => {
    window.sessionStorage.setItem('wtw:place:watchlist', '2000')
    const s = scroller(1200)
    render(<Screen k="watchlist" />)
    await frames()
    expect(s.el.scrollTop).toBe(600)
    s.grow(1800)
    await frames()
    expect(s.el.scrollTop).toBe(1200)
    s.grow(4000)
    await frames()
    expect(s.el.scrollTop).toBe(2000)
  })

  it('your own touch stops a restore', async () => {
    window.sessionStorage.setItem('wtw:place:you', '2000')
    const s = scroller(1200)
    render(<Screen k="you" />)
    await frames()
    window.dispatchEvent(new Event('touchstart'))
    s.grow(4000)
    await frames()
    expect(s.el.scrollTop).toBe(600)
  })

  it('no key (For you before FOR_YOU_V3): nothing saved, nothing restored', async () => {
    const s = scroller(3000)
    render(<Screen k={null} />)
    s.scrollTo(700)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('an inner page keeps its own place apart from its tab', async () => {
    const a = scroller(3000)
    const { rerender } = render(<Screen k="watchlist" />)
    a.scrollTo(400)
    rerender(<Screen k="watchlist:/" />)
    await frames()
    a.scrollTo(1500)
    expect(window.sessionStorage.getItem('wtw:place:watchlist')).toBe('400')
    expect(window.sessionStorage.getItem('wtw:place:watchlist:/')).toBe('1500')
  })

  it('a second, keyless copy (the bar over a loading screen) coming and going leaves the real one saving', async () => {
    const a = scroller(3000)
    const { rerender } = render(<><Screen k="watchlist" /></>)
    rerender(<><Screen k="watchlist" /><Screen k={null} /></>)
    rerender(<><Screen k="watchlist" /></>)
    a.scrollTo(500)
    expect(window.sessionStorage.getItem('wtw:place:watchlist')).toBe('500')
  })

  it('a restore that runs out of time keeps the deeper place it was going for', async () => {
    window.sessionStorage.setItem('wtw:place:watchlist', '2000')
    const s = scroller(1200)
    render(<Screen k="watchlist" />)
    await act(async () => { vi.advanceTimersByTime(4500) })
    // The restore's own last move reports late, as a browser's scroll event does.
    s.el.dispatchEvent(new Event('scroll'))
    expect(s.el.scrollTop).toBe(600)
    expect(window.sessionStorage.getItem('wtw:place:watchlist')).toBe('2000')
  })

  it('leaving the screens with a tab bar stops saving under its key', async () => {
    const a = scroller(3000)
    const { unmount } = render(<Screen k="watchlist" />)
    a.scrollTo(300)
    unmount()
    a.scrollTo(900)
    expect(window.sessionStorage.getItem('wtw:place:watchlist')).toBe('300')
  })

  it('switching from one tab to another never saves the new screen under the old key', async () => {
    const a = scroller(3000)
    const { rerender } = render(<Screen k="watchlist" />)
    a.scrollTo(250)
    rerender(<Screen k="you" />)
    a.scrollTo(1100)
    expect(window.sessionStorage.getItem('wtw:place:watchlist')).toBe('250')
    expect(window.sessionStorage.getItem('wtw:place:you')).toBe('1100')
  })
})
