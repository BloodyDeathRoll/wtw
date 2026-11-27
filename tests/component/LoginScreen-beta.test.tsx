import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

// Closed beta login (#463, #465): the normal screen keeps its title and "Closed Beta test";
// a refused account sees only the logo, the reason and the Google button.

vi.mock('@/modules/session/components/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOAuth: vi.fn() } }) }))
const { default: LoginScreen } = await import('@/app/login/LoginScreen')

afterEach(cleanup)

describe('LoginScreen', () => {
  it('normal: title, "Closed Beta test" and the button', () => {
    render(<LoginScreen />)
    expect(screen.getByText(/not the average Joe/)).toBeTruthy()
    expect(screen.getByText('Closed Beta test')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })

  it('refused: no title or subtitle, just the reason and the button', () => {
    render(<LoginScreen notApproved />)
    expect(screen.queryByText(/not the average Joe/)).toBeNull()
    expect(screen.queryByText('Closed Beta test')).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/isn.t on the closed beta list yet/)
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })
})
