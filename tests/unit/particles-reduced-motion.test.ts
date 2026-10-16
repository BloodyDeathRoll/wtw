import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountParticles } from '@/modules/session/components/particles'

// Under prefers-reduced-motion the particle field is drawn once as a still
// image (no animation loop), and it follows the setting live.

type Listener = (e: { matches: boolean }) => void

function fakeMotionQuery(initial: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: initial,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    set(matches: boolean) {
      mql.matches = matches
      for (const fn of listeners) fn({ matches })
    },
    listenerCount: () => listeners.size,
  }
}

let raf: ReturnType<typeof vi.fn>
let drawn: number

beforeEach(() => {
  drawn = 0
  const ctx = {
    setTransform() {},
    clearRect() {},
    drawImage: () => void drawn++,
    beginPath() {},
    arc() {},
    fill() {},
    globalAlpha: 1,
    filter: '',
    fillStyle: '',
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 800,
  } as DOMRect)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  raf = vi.fn(() => 1)
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('particles under reduced motion', () => {
  it('draws one still frame and runs no loop', () => {
    fakeMotionQuery(true)
    const h = mountParticles(document.createElement('canvas'))
    expect(drawn).toBeGreaterThan(0)
    expect(raf).not.toHaveBeenCalled()
    h.stop()
  })

  it('animates when motion is allowed', () => {
    fakeMotionQuery(false)
    const h = mountParticles(document.createElement('canvas'))
    expect(raf).toHaveBeenCalled()
    h.stop()
  })

  it('stops and restarts the loop when the setting changes live', () => {
    const q = fakeMotionQuery(false)
    const h = mountParticles(document.createElement('canvas'))
    raf.mockClear()

    q.set(true)
    expect(raf).not.toHaveBeenCalled()

    q.set(false)
    expect(raf).toHaveBeenCalled()
    h.stop()
  })

  it('redraws after setDensity in still mode', () => {
    fakeMotionQuery(true)
    const h = mountParticles(document.createElement('canvas'))
    drawn = 0
    h.setDensity(2)
    expect(drawn).toBeGreaterThan(0)
    h.stop()
  })

  it('drops its listener on stop', () => {
    const q = fakeMotionQuery(true)
    const h = mountParticles(document.createElement('canvas'))
    h.stop()
    expect(q.listenerCount()).toBe(0)
  })
})
