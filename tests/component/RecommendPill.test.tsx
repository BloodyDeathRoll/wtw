import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecommendPill from '@/modules/session/components/RecommendPill'

// Proves the RTL + jsdom + CSS-module pipeline works end to end.
describe('<RecommendPill />', () => {
  it('renders the label and fires onClick', async () => {
    const onClick = vi.fn()
    render(<RecommendPill onClick={onClick} />)

    const button = screen.getByRole('button', { name: /recommendations ready/i })
    expect(button).toBeInTheDocument()

    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
