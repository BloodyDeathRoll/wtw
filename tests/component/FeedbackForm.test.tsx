import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// v3 Y2 (YOU.md DEC-5; you-v3/3-feedback.jpg, 4-feedback-sent.jpg): the feedback page's states.

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const { FeedbackForm } = await import('@/app/you/feedback/FeedbackForm')

let answer: () => Promise<Response>
beforeEach(() => {
  push.mockClear()
  answer = async () => new Response('{"ok":true}')
  globalThis.fetch = vi.fn(() => answer()) as unknown as typeof fetch
})

describe('<FeedbackForm />', () => {
  it('Send is dimmed until there is text', async () => {
    render(<FeedbackForm />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Your note'), 'Hi')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(screen.getByText('Sent with your email address, so we can reply.')).toBeInTheDocument()
  })
  it('sent: the box goes, the thanks shows, Back to You returns', async () => {
    render(<FeedbackForm />)
    await userEvent.type(screen.getByLabelText('Your note'), 'Great app')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Thanks, it’s with the team.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your note')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back to You' }))
    expect(push).toHaveBeenCalledWith('/you')
  })
  it('it fails: the note stays in the box, the red line shows, Send works again', async () => {
    answer = async () => new Response('{}', { status: 500 })
    render(<FeedbackForm />)
    await userEvent.type(screen.getByLabelText('Your note'), 'Keep me')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send it. Your note is still here; try again in a moment.')
    expect(screen.getByLabelText('Your note')).toHaveValue('Keep me')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
  it('sending: "Sending…", and a second tap does nothing', async () => {
    let release!: () => void
    answer = () => new Promise(r => { release = () => r(new Response('{}')) })
    render(<FeedbackForm />)
    await userEvent.type(screen.getByLabelText('Your note'), 'Once')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Sending…' }))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    release()
  })
})
