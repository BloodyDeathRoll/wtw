/**
 * Q3 (#366): Search's empty box shows your recent searches (SEARCH_V3), as rendered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

let v3 = true
vi.mock('@/lib/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/flags')>()), searchV3Enabled: () => v3 }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))
vi.mock('@/lib/watchlist', async (orig) => ({ ...(await orig<typeof import('@/lib/watchlist')>()), hydrateWatchlist: vi.fn(async () => {}) }))

import SearchView from '@/app/search/SearchView'
import { rememberSearch } from '@/app/search/recent'

const user = { id: 'u1', email: null, name: 'E', avatarUrl: null }

beforeEach(() => {
  v3 = true
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Search: recent searches in the empty box', () => {
  it('none yet: the box alone, no list', () => {
    render(<SearchView user={user} />)
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull()
  })

  it('shows them newest first, and a tap searches it again', () => {
    rememberSearch('memento')
    rememberSearch('Christopher Nolan')
    render(<SearchView user={user} />)
    const list = screen.getByRole('listbox', { name: 'Recent searches' })
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['Christopher Nolan', 'memento'])
    fireEvent.click(screen.getByRole('option', { name: 'memento' }))
    expect((screen.getByRole('searchbox', { name: 'Search titles and people' }) as HTMLInputElement).value).toBe('memento')
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull()
  })

  it('Clear empties the list', () => {
    rememberSearch('memento')
    render(<SearchView user={user} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear' })) })
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull()
    expect(window.localStorage.getItem('wtw:recent-searches')).toBeNull()
  })

  it('the flag off: no list, even with searches stored', () => {
    v3 = false
    rememberSearch('memento')
    render(<SearchView user={user} />)
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull()
  })
})
