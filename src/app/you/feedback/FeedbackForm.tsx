'use client'
/**
 * The feedback page's form (v3 Y2, YOU.md DEC-5; you-v3/3-feedback.jpg, 4-feedback-sent.jpg). Send is dimmed until
 * there's text and can't be tapped twice; on any error the note stays in the box with a red line, so nothing typed is
 * ever lost; once sent, the box goes and a thanks shows with Back to You. Nothing is kept on the phone afterwards.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import s from '../you.module.css'

const MAX = 2000

export function FeedbackForm() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  async function send() {
    if (!text.trim() || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setText('')
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  if (state === 'sent') {
    return (
      <div className={s.fb}>
        <h2 className={s.fbThanks}>Thanks, it’s with the team.</h2>
        <p className={s.fbIntro}>If it needs an answer, we’ll reply by email.</p>
        <button type="button" className={s.sheetOpt} onClick={() => router.push('/you')}>Back to You</button>
      </div>
    )
  }

  return (
    <div className={s.fb}>
      <p className={s.fbIntro}>Tell us what to fix, or what you’d love to see. It goes straight to the team, and we read every note.</p>
      <textarea
        className={s.fbBox}
        value={text}
        onChange={e => { setText(e.target.value); if (state === 'failed') setState('idle') }}
        placeholder="Write your note here"
        maxLength={MAX}
        aria-label="Your note"
        disabled={state === 'sending'}
      />
      {state === 'failed'
        ? <p className={s.fbError} role="alert">Couldn’t send it. Your note is still here; try again in a moment.</p>
        : <p className={s.fbNote}>Sent with your email address, so we can reply.</p>}
      <button type="button" className={s.sheetCta} onClick={send} disabled={!text.trim() || state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}
