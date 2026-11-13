import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { DnaFrame } from '@/app/profile/dna/DnaFrame'

// My taste's quick-return header (2026-11-14): gone while you scroll down, back the moment you scroll up,
// always there at the top.

let now = 0
beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 70 })
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const { container } = render(<DnaFrame header={<header><input aria-label="search" /></header>}><p>page</p></DnaFrame>)
  const slot = container.firstElementChild as HTMLDivElement
  const scroller = slot.nextElementSibling as HTMLDivElement
  const scrollTo = (y: number) => act(() => { scroller.scrollTop = y; scroller.dispatchEvent(new Event('scroll')) })
  const settle = () => { now += 400 }
  return { slot, scroller, scrollTo, settle }
}

describe('<DnaFrame /> quick return', () => {
  it('hides on a scroll down past the header, comes back on a small scroll up', () => {
    const { slot, scrollTo, settle } = setup()
    scrollTo(100); scrollTo(130)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    settle()
    scrollTo(125); scrollTo(120)
    expect(slot.getAttribute('aria-hidden')).toBeNull()
  })
  it('stays while you are within the header\'s height of the top', () => {
    const { slot, scrollTo } = setup()
    scrollTo(30); scrollTo(60)
    expect(slot.getAttribute('aria-hidden')).toBeNull()
  })
  it('ignores the jump while it moves (the page height changes under the scroll)', () => {
    const { slot, scrollTo } = setup()
    scrollTo(200); scrollTo(230)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    scrollTo(160)   // clamped at the bottom as the scroller grows: not a scroll up
    expect(slot.getAttribute('aria-hidden')).toBe('true')
  })
  it('never hides while the search box has focus', () => {
    const { slot, scrollTo } = setup()
    ;(slot.querySelector('input') as HTMLInputElement).focus()
    scrollTo(200); scrollTo(260)
    expect(slot.getAttribute('aria-hidden')).toBeNull()
  })
})
