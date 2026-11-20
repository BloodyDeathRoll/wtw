/**
 * v3 N2: which place the tab bar keeps (Eran on #357, option A): every tab and inner page its own, For you only
 * once FOR_YOU_V3 is on, and nothing with NAV_HISTORY off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const flags = { nav: true, forYou: false }
vi.mock('@/lib/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/flags')>()),
  navHistoryEnabled: () => flags.nav,
  forYouV3Enabled: () => flags.forYou,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const keys: (string | null)[] = []
vi.mock('@/modules/session/tab-place', () => ({ useTabPlace: (k: string | null) => { keys.push(k) } }))

import { TabBar } from '@/app/components/TabBar'

const user = { id: 'u', email: null, name: 'E', avatarUrl: null }
const keyFor = (props: Partial<Parameters<typeof TabBar>[0]>) => {
  keys.length = 0
  render(<TabBar active="watchlist" user={user} {...props} />)
  cleanup()
  return keys[0]
}
afterEach(() => { flags.nav = true; flags.forYou = false })

describe('TabBar: the place it keeps', () => {
  it('each tab its own; an inner page apart from its tab', () => {
    expect(keyFor({ active: 'watchlist' })).toBe('watchlist')
    expect(keyFor({ active: 'games' })).toBe('games')
    expect(keyFor({ active: 'you' })).toBe('you')
    expect(keyFor({ active: 'watchlist', atRoot: false })).toBe('watchlist:/')
  })
  it('For you only once FOR_YOU_V3 is on', () => {
    expect(keyFor({ active: 'foryou' })).toBeNull()
    flags.forYou = true
    expect(keyFor({ active: 'foryou' })).toBe('foryou')
  })
  it('nothing with NAV_HISTORY off, or on the copy over a loading screen', () => {
    flags.nav = false
    expect(keyFor({ active: 'watchlist' })).toBeNull()
    flags.nav = true
    expect(keyFor({ active: 'watchlist', keepPlace: false })).toBeNull()
  })
})
