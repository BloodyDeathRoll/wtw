import { describe, it, expect, vi } from 'vitest'
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
  it('Start my taste over first, then Sign out', () => {
    render(<AccountRows />)
    const rows = screen.getAllByRole('button').map(b => b.textContent ?? '')
    expect(rows[0]).toMatch(/^Start my taste over/)
    expect(rows[1]).toBe('Sign out')
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
