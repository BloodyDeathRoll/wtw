import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HeaderSearch } from '@/app/components/HeaderSearch'
import { AppMenu } from '@/modules/session/components/AppMenu'

// Search opened from a header stays on the host screen (2026-11-07): the
// search view is swept in over it and only the URL becomes /search, so the
// field focused in the tap never re-mounts and the keyboard stays up. The
// menu in the search header is the host's own: a tap on an entry pops the
// search off first, then the host's handler runs (on the home that's a stage
// switch, which a /?stage= push could never do — it reads ?stage= once, on
// mount; reviewer, PR #220).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@/lib/watchlist', () => ({
  getWatchlist: () => [],
  hydrateWatchlist: async () => {},
  isInWatchlist: () => false,
  addToWatchlist: () => {},
  removeFromWatchlist: () => {},
}))

const user = { id: 'u1', email: 'a@b.c', name: 'Ann', avatarUrl: null }

function Host({ onWatchlist }: { onWatchlist: () => void }) {
  const menu = (
    <AppMenu
      onRecommend={() => {}}
      onWatchlist={onWatchlist}
      onFastLearning={() => {}}
      onRatings={() => {}}
      onProfile={() => {}}
      user={user}
      onSignOut={() => {}}
      voice="Kore"
      setVoice={() => {}}
    />
  )
  return (
    <div>
      <HeaderSearch btnClass="b" user={user} menu={menu} scope="watchlist" from="watchlist" />
      {menu}
    </div>
  )
}

describe('<HeaderSearch />', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens the search in place: the field is focused in the tap, the URL is /search, the host stays', async () => {
    const onWatchlist = vi.fn()
    render(<Host onWatchlist={onWatchlist} />)
    await userEvent.click(screen.getByRole('button', { name: 'search' }))
    const field = screen.getByRole('searchbox')
    expect(document.activeElement).toBe(field)
    expect(window.location.pathname + window.location.search).toBe('/search?in=watchlist&from=watchlist')
    // The host is still mounted under it: its own search icon is still there.
    expect(screen.getByRole('button', { name: 'search' })).toBeInTheDocument()
  })

  it('a menu entry tapped in the search pops the search off, then runs the host’s handler', async () => {
    const onWatchlist = vi.fn()
    render(<Host onWatchlist={onWatchlist} />)
    await userEvent.click(screen.getByRole('button', { name: 'search' }))
    // Two menus now (the host's, and its clone in the search); open the search's.
    const menus = screen.getAllByRole('button', { name: 'menu' })
    await userEvent.click(menus[menus.length - 1])
    await userEvent.click(screen.getByText('Watchlist'))
    await waitFor(() => expect(onWatchlist).toHaveBeenCalledTimes(1))
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('Back pops the search off without running anything', async () => {
    const onWatchlist = vi.fn()
    render(<Host onWatchlist={onWatchlist} />)
    await userEvent.click(screen.getByRole('button', { name: 'search' }))
    await userEvent.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    expect(window.location.pathname).toBe('/')
    expect(onWatchlist).not.toHaveBeenCalled()
  })
})
