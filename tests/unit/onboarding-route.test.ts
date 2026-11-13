import { describe, it, expect } from 'vitest'
import { freshState, type PlayState } from '@/app/play/lib/brain'
import { needsOnboarding, EXISTING_USER_SIGNALS } from '@/lib/onboarding-route'

// P2-U6: who `/` sends to /onboarding (and who /onboarding sends back to the feed). One rule, so no bouncing.
describe('Who goes through the new onboarding', () => {
  const at = (onboarding: PlayState['onboarding']): PlayState => ({ ...freshState(), onboarding })

  it('a new account goes through it', () => {
    expect(needsOnboarding(null, 0)).toBe(true)
    expect(needsOnboarding(freshState(), EXISTING_USER_SIGNALS - 1)).toBe(true)
  })

  it('an existing account with 10+ signals that never started it skips it', () => {
    expect(needsOnboarding(null, EXISTING_USER_SIGNALS)).toBe(false)
    expect(needsOnboarding(freshState(), 250)).toBe(false)
  })

  it('once started, it is finished first, however many ratings the cards gave', () => {
    expect(needsOnboarding(at({ step: 'cards' }), 25)).toBe(true)
    expect(needsOnboarding(at({ step: 'picks' }), 40)).toBe(true)
    expect(needsOnboarding(at({ step: 'showtime' }), 40)).toBe(true)
  })

  it('done is done', () => {
    expect(needsOnboarding(at({ step: 'showtime', done_at: '2026-11-13T12:00:00Z' }), 0)).toBe(false)
  })
})
