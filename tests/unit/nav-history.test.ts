// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { markInApp, stageHref, stageOfAddress } from '@/modules/session/nav-history'

// N1 (docs/plan/v3/YOU.md DEC-1): the stage is in the address, so Back finds it again.

const at = (url: string) => new URL(url, 'http://x')

describe('stageHref', () => {
  it('For you is the root; the other stages are ?stage=', () => {
    expect(stageHref('recommendations')).toBe('/')
    expect(stageHref('watchlist')).toBe('/?stage=watchlist')
    expect(stageHref('conversation')).toBe('/?stage=conversation')
    expect(stageHref('ratings')).toBe('/?stage=ratings')
    expect(stageHref('learning')).toBe('/?stage=learning')
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

describe('markInApp', () => {
  const store = new Map<string, string>()
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  it('is false the first time in a browser tab, true after', () => {
    vi.stubGlobal('sessionStorage', fake)
    store.clear()
    expect(markInApp()).toBe(false)
    expect(markInApp()).toBe(true)
    vi.unstubAllGlobals()
  })
  it('is true when storage is blocked, so nothing is put under (today\'s Back)', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => {} })
    expect(markInApp()).toBe(true)
    vi.unstubAllGlobals()
  })
})

// Source-level, like chat-entry.test.ts: WTWApp has no render harness. These match exact source lines, so a reformat of
// those lines needs them updated too.
describe('WTWApp under NAV_HISTORY', () => {
  const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
  it('is only on under the tab bar', () => {
    expect(app).toContain('const navHistory = tabsOn && navHistoryEnabled();')
  })
  it('puts For you under a stage only when WTW was opened straight on it', () => {
    expect(app).toContain('const fresh = !markInApp();')
    expect(readFileSync('src/app/components/TabBar.tsx', 'utf8')).toContain('if (!onTab) markInApp();')
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
