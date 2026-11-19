// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stageHref, stageOfAddress } from '@/modules/session/nav-history'

// N1 (docs/plan/v3/YOU.md DEC-1): the stage is in the address, so Back finds it again.

const at = (url: string) => new URL(url, 'http://x')

describe('stageHref', () => {
  it('For you is the root; the other stages are ?stage=', () => {
    expect(stageHref('recommendations')).toBe('/')
    expect(stageHref('watchlist')).toBe('/?stage=watchlist')
    expect(stageHref('conversation')).toBe('/?stage=conversation')
    expect(stageHref('ratings')).toBe('/?stage=ratings')
  })
  it('the old home screen stages have none', () => {
    for (const s of ['intro', 'onboard', 'welcome']) expect(stageHref(s)).toBeNull()
  })
})

describe('stageOfAddress', () => {
  it('reads the stage back from its address', () => {
    for (const s of ['recommendations', 'watchlist', 'conversation', 'ratings', 'learning']) {
      expect(stageOfAddress(at(stageHref(s)!))).toBe(s)
    }
    expect(stageOfAddress(at('/?stage=recommendations'))).toBe('recommendations')
  })
  it('names none for another route or a stage that is not ours', () => {
    expect(stageOfAddress(at('/you'))).toBeNull()
    expect(stageOfAddress(at('/search?from=watchlist'))).toBeNull()
    expect(stageOfAddress(at('/?stage=intro'))).toBeNull()
  })
})

// Source-level, like chat-entry.test.ts: WTWApp has no render harness.
describe('WTWApp under NAV_HISTORY', () => {
  const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
  it('is only on under the tab bar', () => {
    expect(app).toContain('const navHistory = tabsOn && navHistoryEnabled();')
  })
  it('pushes a step only when the stage really changes, and restores it on Back', () => {
    expect(app).toContain('if (prev === null || prev === stage) return;')
    expect(app).toContain('window.history.pushState(null, "", href)')
    expect(app).toMatch(/addEventListener\("popstate", onPop\)/)
  })
  it("the chat's and Seen's on-screen Back go back a step", () => {
    expect(app).toMatch(/if \(navHistory\) \{\s*window\.history\.back\(\);\s*return;/)
    expect(app).toContain('onBack={navHistory ? () => window.history.back() : tabsOn ? () => leaveTo("/you")')
  })
  it('flag off keeps today\'s address handling', () => {
    expect(app).toContain('if (s || q.has("from")) window.history.replaceState(null, "", window.location.pathname);')
  })
})
