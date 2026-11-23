import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// v3 Y1 (YOU.md DEC-3; you-v3/1-account-row.jpg, 2-account-page.jpg): You ends with one card of two rows
// (Send us feedback, Account ›); Account is its own page with Start my taste over, then Sign out.

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), signOut: vi.fn(async () => ({})) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/font/google', () => ({ Bebas_Neue: () => ({ variable: 'bebas' }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: nav.signOut } }) }))

const { YouLinksCard, AccountRows } = await import('@/app/you/YouCards')

describe('the bottom of You', () => {
  it('Account › opens its own page; the old Account box (Sign out, Start over) is gone from You', () => {
    render(<YouLinksCard />)
    expect(screen.getByRole('link', { name: /Account/ })).toHaveAttribute('href', '/you/account')
    expect(screen.queryByText('Sign out')).toBeNull()
    expect(screen.queryByText('Start my taste over')).toBeNull()
    expect(screen.queryByText('ACCOUNT')).toBeNull()
  })
  it('Send us feedback waits for the email service (Y2): no row that leads nowhere', () => {
    render(<YouLinksCard />)
    expect(screen.queryByText('Send us feedback')).toBeNull()
  })
  it('with the email service set up: Send us feedback first, then Account', () => {
    render(<YouLinksCard feedback />)
    const links = screen.getAllByRole('link')
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/you/feedback', '/you/account'])
    expect(screen.getByText('Tell us what to fix, or what you’d love to see.')).toBeInTheDocument()
  })
})

describe('the Account page', () => {
  it('Start my taste over, then Sign out, then Delete my account last', () => {
    render(<AccountRows />)
    const rows = screen.getAllByRole('button').map(b => b.textContent ?? '')
    expect(rows[0]).toMatch(/^Start my taste over/)
    expect(rows[1]).toBe('Sign out')
    expect(rows[2]).toMatch(/^Delete my account/)
    expect(screen.getByText('Teach WTW your taste from scratch. Your Watchlist and game scores stay.')).toBeInTheDocument()
  })
  it('Sign out acts at once (no sheet) and goes to the login page', async () => {
    render(<AccountRows />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(nav.signOut).toHaveBeenCalled()
    expect(nav.replace).toHaveBeenCalledWith('/login')
  })
  it('Start my taste over asks first, in today\'s sheet', async () => {
    render(<AccountRows />)
    await userEvent.click(screen.getByRole('button', { name: /Start my taste over/ }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Start your taste over?')
  })
})

describe('Delete my account (v3 Y3)', () => {
  it('asks first, with the approved text; Cancel closes it', async () => {
    render(<AccountRows />)
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }))
    const sheet = screen.getByRole('alertdialog')
    expect(sheet).toHaveTextContent('Delete your account?')
    expect(sheet).toHaveTextContent('your game scores, your chats and the notes you sent us')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
  it('it fails: the red line, and the sheet stays open', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    render(<AccountRows />)
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t delete your account just now. Try again in a moment.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
  it('deleted: signs this browser out and opens the login page', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"ok":true}')) as unknown as typeof fetch
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true })
    onTestFinished(() => { Object.defineProperty(window, 'location', { value: original, writable: true }) })
    render(<AccountRows />)
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!)
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    expect(nav.signOut).toHaveBeenCalled()
  })
})
