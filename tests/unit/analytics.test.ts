// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// GA4 helper (src/lib/analytics.ts): off without NEXT_PUBLIC_GA_ID; with it,
// commands reach window.dataLayer as Arguments objects (gtag.js ignores arrays),
// and the onboarding events carry the run count and the duration.

const load = async (id: string) => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_GA_ID', id)
  return import('@/lib/analytics')
}
const calls = () => (window.dataLayer ?? []).map(a => Array.from(a as ArrayLike<unknown>))
const events = (name: string) => calls().filter(c => c[0] === 'event' && c[1] === name).map(c => c[2] as Record<string, unknown>)

beforeEach(() => { window.dataLayer = []; localStorage.clear(); vi.useRealTimers() })

describe('analytics', () => {
  it('does nothing without a measurement id', async () => {
    const a = await load('')
    a.initAnalytics('u1')
    a.track('watchlist_add', { items: 1 })
    expect(window.dataLayer).toEqual([])
  })

  it('pushes Arguments objects; config carries the user id with ad signals off', async () => {
    const a = await load('G-TEST')
    a.initAnalytics('u1')
    a.identify(null)
    a.track('watchlist_add', { items: 3 })
    expect(Object.prototype.toString.call(window.dataLayer![0])).toBe('[object Arguments]')
    expect(calls()[1]).toEqual(['config', 'G-TEST', { allow_google_signals: false, allow_ad_personalization_signals: false, user_id: 'u1' }])
    expect(calls()[2]).toEqual(['set', { user_id: null }])
    expect(events('watchlist_add')).toEqual([{ items: 3 }])
  })

  it('onboarding: counts runs and times from the first start, then resets', async () => {
    const a = await load('G-TEST')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'))
    a.onboardingStarted()
    vi.setSystemTime(new Date('2026-11-27T10:03:00Z'))
    a.onboardingStarted() // left and came back
    vi.setSystemTime(new Date('2026-11-27T10:05:30Z'))
    a.onboardingCompleted()
    expect(events('onboarding_start')).toEqual([{ run: 1 }, { run: 2 }])
    expect(events('onboarding_complete')).toEqual([{ runs: 2, one_run: false, duration_sec: 330 }])
    a.onboardingStarted()
    expect(events('onboarding_start').at(-1)).toEqual({ run: 1 })
  })
})
