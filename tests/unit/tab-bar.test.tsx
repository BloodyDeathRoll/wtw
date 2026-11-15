import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

// The bottom tab bar (NAV_TABS, Eran 2026-11-15; docs/prototypes/nav).

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }) }))

import { TabBar, TAB_HREF } from '@/app/components/TabBar'
import { navTabsEnabled } from '@/lib/flags'
import { WATCHLIST_CHANGED_EVENT } from '@/lib/watchlist'

const user = { id: 'u1', email: 's@example.com', name: 'Solomon Kaputnik', avatarUrl: null }

beforeEach(() => { localStorage.clear(); push.mockClear() })
afterEach(() => { cleanup(); delete process.env.NAV_TABS })

describe('the switch', () => {
  it('is off unless NAV_TABS is on', () => {
    expect(navTabsEnabled()).toBe(false)
    process.env.NAV_TABS = 'true'
    expect(navTabsEnabled()).toBe(true)
  })
  it('reaches the client (next.config env)', () => {
    expect(readFileSync('next.config.ts', 'utf8')).toMatch(/NAV_TABS: process\.env\.NAV_TABS \?\? ""/)
  })
})

describe('TabBar', () => {
  it('shows For you · Watchlist · Games · You, the active one marked', () => {
    render(<TabBar active="games" user={user} />)
    const tabs = screen.getAllByRole('button')
    expect(tabs.map(t => t.textContent)).toEqual(['For you', 'Watchlist', 'Games', 'S' + 'You'])
    expect(screen.getByRole('button', { name: 'Games' }).getAttribute('aria-current')).toBe('page')
  })

  it('goes to a tab by route, unless the host switches to it itself', () => {
    const onTab = vi.fn((t: string) => t === 'watchlist')
    render(<TabBar active="foryou" user={user} onTab={onTab} />)
    fireEvent.click(screen.getByRole('button', { name: 'Watchlist' }))
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'You' }))
    expect(push).toHaveBeenCalledWith(TAB_HREF.you)
  })

  it('tapping the tab you are on scrolls it to the top; on an inner page it returns to the tab', () => {
    const el = document.createElement('div')
    el.setAttribute('data-tab-scroll', '')
    el.scrollTo = vi.fn() as never
    document.body.appendChild(el)
    const { unmount } = render(<TabBar active="foryou" user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'For you' }))
    expect(el.scrollTo).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    unmount()
    render(<TabBar active="you" atRoot={false} user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'You' }))
    expect(push).toHaveBeenCalledWith('/you')
    el.remove()
  })

  it('carries the watchlist count, and follows it', () => {
    render(<TabBar active="foryou" user={user} />)
    expect(screen.getByRole('button', { name: 'Watchlist' })).toBeTruthy()
    localStorage.setItem('wtw_watchlist', JSON.stringify([{ rec: { id: 'movie:1', title: 'A' } }, { rec: { id: 'movie:2', title: 'B' } }]))
    act(() => { window.dispatchEvent(new Event(WATCHLIST_CHANGED_EVENT)) })
    expect(screen.getByRole('button', { name: 'Watchlist, 2 saved' }).textContent).toContain('2')
  })

  it('steps aside while a text field has focus (the keyboard is up)', () => {
    const { container } = render(<TabBar active="foryou" user={user} />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => { input.focus() })
    expect(container.querySelector('nav')!.className).toMatch(/away/)
    act(() => { input.blur() })
    expect(container.querySelector('nav')!.className).not.toMatch(/away/)
    input.remove()
  })
})

// Source-level, like chat-entry.test.ts: WTWApp has no render harness.
describe('the home route under the bar', () => {
  const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
  it('opens on For you, with no home screen to go back to', () => {
    expect(app).toMatch(/useState<Stage>\(isNewUser \? "intro" : tabsOn \? "recommendations" : "onboard"\)/)
    expect(app).toMatch(/setStage\(tabsOn \? "recommendations" : "onboard"\)/)
  })
  it('puts the chat bubble where the back arrow was, and drops the ☰', () => {
    expect(app).toMatch(/const headerLeft = tabsOn \? \(onChat \? <AskButton/)
    expect(app).toMatch(/const headerMenu = tabsOn \? null : appMenu;/)
  })
  it("the chat's Back returns to where the chat was opened", () => {
    expect(app).toMatch(/chatBackRef\.current = \{ stage \};/)
    expect(app).toMatch(/if \(tabsOn && from\?\.href\) leaveTo\(from\.href\);/)
    expect(app).toMatch(/const CHAT_BACK = \/\^\\\/\(play\\\?tab=games\|you\)\$\/;/)
    expect(readFileSync('src/app/play/components/ui.tsx', 'utf8')).toMatch(/stage=conversation&back=\$\{encodeURIComponent\('\/play\?tab=games'\)\}/)
    expect(readFileSync('src/app/profile/dna/DnaHeader.tsx', 'utf8')).toMatch(/stage=conversation&back=\$\{encodeURIComponent\("\/you"\)\}/)
  })
  it('moves the 48-hour check-in to For you, and reports saves when a tab leaves the cards', () => {
    expect(app).toMatch(/\{tabsOn && regret && \(/)
    expect(app).toMatch(/if \(stage === "recommendations" \|\| stage === "watchlist"\) syncSaves\(\);/)
  })
})
