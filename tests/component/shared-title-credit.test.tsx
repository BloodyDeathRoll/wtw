import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Recommendation } from '@/types/recommendation'

// v3 L1 follow-up (Eran on #396): the public share page credits JustWatch once, under the card, only when the card
// names a service.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/modules/session/components/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOAuth: vi.fn() } }) }))
vi.mock('@/lib/share', () => ({ shareTitle: vi.fn() }))

import SharedTitleView from '@/app/t/[key]/SharedTitleView'

const rec = (where: string | null): Recommendation => ({
  id: 'tv:95480', title: 'Slow Horses', type: 'tv', year: 2022, poster_url: null, meta: 'Series', rating: 8,
  match: 0, reason: '', where, motif: 'dot', palette: ['#16242E', '#F5C9A6'],
})
const page = (where: string | null) =>
  render(<SharedTitleView shareKey="tv-95480" rec={rec(where)} synopsis="Follow a dysfunctional team of MI5 agents." by={null} userId={null} viewerName={null} newUser={false} saveOnLoad={false} />)

afterEach(cleanup)

describe('the share page credits JustWatch', () => {
  it('once, under the card, when the card names a service', () => {
    page('Apple TV')
    expect(screen.getByText('Streaming on Apple TV.')).toBeInTheDocument()
    expect(screen.getAllByText('Where to watch: JustWatch')).toHaveLength(1)
  })
  it('not at all when it names none', () => {
    page(null)
    expect(screen.queryByText('Where to watch: JustWatch')).toBeNull()
  })
})
