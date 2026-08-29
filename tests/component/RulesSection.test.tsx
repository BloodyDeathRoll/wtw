import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RulesSection } from '@/app/profile/dna/RulesSection'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const EXCLUSIONS = [
  { type: 'keyword' as const, id: '', name: 'anime', raw: 'no anime', reason: 'never liked it' },
  { type: 'person' as const, id: '103', name: 'Mark Ruffalo', raw: '', reason: '' },
]

describe('<RulesSection />', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists the rules the user gave in conversation', () => {
    render(<RulesSection exclusions={EXCLUSIONS} softPreferences={[]} />)
    expect(screen.getByText('anime')).toBeInTheDocument()
    expect(screen.getByText('Mark Ruffalo')).toBeInTheDocument()
  })

  it('says so when there are none — the user needs to see whether it registered', () => {
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    expect(screen.getByText(/no standing rules yet/i)).toBeInTheDocument()
  })

  it('removes a rule and drops the row', async () => {
    render(<RulesSection exclusions={EXCLUSIONS} softPreferences={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /never show me anime/i }))

    await waitFor(() => expect(screen.queryByText('anime')).not.toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/dna/rules', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ kind: 'exclusion', key: 'keyword:anime' }),
    }))
    // The other rule is untouched.
    expect(screen.getByText('Mark Ruffalo')).toBeInTheDocument()
  })

  it('puts the row back when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    render(<RulesSection exclusions={EXCLUSIONS} softPreferences={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /never show me anime/i }))

    await waitFor(() => expect(screen.getByText(/couldn't remove that/i)).toBeInTheDocument())
    expect(screen.getByText('anime')).toBeInTheDocument()
  })

  it('shows a soft preference as how much less, not as a raw weight', () => {
    render(<RulesSection exclusions={[]} softPreferences={[{ signal: 'romance', weight_modifier: 0.3 }]} />)
    expect(screen.getByText('70% less')).toBeInTheDocument()
  })
})
