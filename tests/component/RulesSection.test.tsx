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

// 2026-09-20: the conversation was the only writer of standing rules, so when
// extraction failed there was no way to state one at all.
describe('<RulesSection /> — adding a rule by hand', () => {
  const addRule = async (name: string, kind?: string) => {
    if (kind) await userEvent.selectOptions(screen.getByLabelText(/rule strength/i), kind)
    await userEvent.type(screen.getByLabelText(/what to rule out/i), name)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, added: true }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the rule and confirms what was stored', async () => {
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    await addRule('horror')

    expect(fetch).toHaveBeenCalledWith('/api/dna/rules', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ kind: 'exclusion', name: 'horror' }),
    }))
    await waitFor(() => expect(screen.getByText(/added — horror/i)).toBeInTheDocument())
  })

  it('sends a hedge as a soft preference', async () => {
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    await addRule('romance', 'soft_preference')

    expect(fetch).toHaveBeenCalledWith('/api/dna/rules', expect.objectContaining({
      body: JSON.stringify({ kind: 'soft_preference', name: 'romance' }),
    }))
  })

  it('says a preference got stronger rather than calling it a duplicate', async () => {
    // Typing "romance" under "Less of" when a weaker one exists tightens it.
    // Saying "already on your list" there hides a change the user just made.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, added: false, updated: true }), { status: 200 })))
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    await addRule('romance', 'soft_preference')

    await waitFor(() => expect(screen.getByText(/strengthened — romance/i)).toBeInTheDocument())
  })

  it('says a rule was already there rather than claiming it added it again', async () => {
    // The user typing it twice is the user unsure whether the first one took.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, added: false, updated: false }), { status: 200 })))
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    await addRule('anime')

    await waitFor(() => expect(screen.getByText(/already on your list — anime/i)).toBeInTheDocument())
  })

  it('clears the box on success so the next rule starts empty', async () => {
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    await addRule('horror')
    await waitFor(() => expect(screen.getByLabelText(/what to rule out/i)).toHaveValue(''))
  })

  it('keeps what was typed when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    await addRule('horror')

    await waitFor(() => expect(screen.getByText(/couldn't add that/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/what to rule out/i)).toHaveValue('horror')
  })

  it('will not submit an empty or whitespace-only rule', async () => {
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/what to rule out/i), '   ')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('points at the form when there are no rules yet', () => {
    render(<RulesSection exclusions={[]} softPreferences={[]} />)
    expect(screen.getByText(/or add one below/i)).toBeInTheDocument()
  })
})
