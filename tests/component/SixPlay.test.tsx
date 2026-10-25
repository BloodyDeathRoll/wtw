import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SixPlay } from '@/app/play/components/six'
import type { Ctl } from '@/app/play/components/types'
import type { SixChain } from '@/app/play/lib/six'

const chain: SixChain = {
  id: 'six:test',
  actors: [1, 2, 3, 4, 5, 6].map((id, k) => ({ id, name: `Actor ${id}`, img: null, roles: k === 0 || k === 5 ? ['A'] : ['A', 'B'] })),
  films: [1, 2, 3, 4, 5].map(k => ({ id: `movie:${k}`, title: `Film ${k}`, year: 2000, poster: null })),
}
const ctl = {
  ui: { game: { six: { chain, deal: 1 } } }, T: [],
  sixLog: vi.fn(), sixFinish: vi.fn(), sixNext: vi.fn(), isSaved: () => false, toggleSave: vi.fn(),
} as unknown as Ctl

// The drag has a keyboard twin (review of #145): a focused middle row moves with ↑/↓.
describe('<SixPlay /> keyboard', () => {
  it('moves a focused row with the arrow keys, never into the fixed start', async () => {
    window.matchMedia ??= (() => ({ matches: true })) as unknown as typeof window.matchMedia
    render(<SixPlay ctl={ctl} />)
    const rows = screen.getAllByRole('button', { name: /place \d of 6/ })
    expect(rows).toHaveLength(4)                                  // only the middle four can move

    const second = screen.getByRole('button', { name: /place 2 of 6/ })
    const who = second.getAttribute('aria-label')!.split(',')[0]
    second.focus()
    await userEvent.keyboard('{ArrowUp}')                         // place 1 is the fixed start: no move
    expect(screen.getByRole('button', { name: new RegExp(`^${who}, place 2 of 6`) })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: new RegExp(`^${who}, place 3 of 6`) })).toBeInTheDocument()
  })
})
