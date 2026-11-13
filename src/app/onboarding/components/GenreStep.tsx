'use client'
/**
 * P2-U2 · The genre step, as signed off in #241 (docs/prototypes/first-run/1-genres-*.jpg; PLAN.md → P2-U0, part 2).
 *
 * "Lights, camera, genres!", the 16 genres with outlined icons, grey until answered. An answer (Love, Like or
 * Never) lights its row: a wash of the genre's colour comes in from the left and the icon lights as it arrives.
 * The same answer again turns it off; another answer only swaps the button. No Skip. Start needs a Love or Like.
 */
import { useState } from 'react'
import { Icon } from '@/app/play/components/ui'
import { GENRES_16, type Genre16 } from '@/app/play/lib/genres16'
import { canStart, type GenreAnswer, type GenreAnswers } from '../lib/genre-step'
import { LOOK } from '../lib/genre-look'

const ANSWERS: { k: GenreAnswer; label: string; icon: React.ReactNode }[] = [
  { k: 'love', label: 'Love', icon: Icon.love },
  { k: 'like', label: 'Like', icon: Icon.like },
  { k: 'never', label: 'Never', icon: Icon.never },
]

export default function GenreStep({ top, onStart, screenRef }: {
  top: React.ReactNode; onStart: (a: GenreAnswers) => void; screenRef?: React.Ref<HTMLDivElement>
}) {
  const [answers, setAnswers] = useState<GenreAnswers>({})
  const tap = (g: Genre16, k: GenreAnswer) =>
    setAnswers(a => {
      const next = { ...a }
      if (next[g] === k) delete next[g]
      else next[g] = k
      return next
    })
  const ok = canStart(answers)
  const answered = Object.keys(answers).length
  const nevers = GENRES_16.filter(g => answers[g.id] === 'never').map(g => g.label)

  return (
    <div className="screen ob-genres" ref={screenRef}>
      {top}
      <div className="setup welcome lit">
        <div>
          <h2>Lights, camera, genres!</h2>
          <p className="sub">Three steps to your first matches. First, tap “Love” or “Like” on every genre you enjoy and “Never” on any you don’t. Blank is neutral.</p>
        </div>
        <div className="grows">
          <div className="grow ghead"><span />{ANSWERS.map(r => <span key={r.k} className={`gh gh-${r.k}`}>{r.label}</span>)}</div>
          {GENRES_16.map(g => {
            const st = answers[g.id], { icon: GIcon, colour } = LOOK[g.id]
            return (
              <div key={g.id} className={`grow${st ? ' rated' : ''}`} role="group" aria-label={g.label} style={{ ['--gc' as string]: colour }}>
                <i className="gwash" aria-hidden="true" />
                <span className="gname m-outline">
                  <i className="gline" aria-hidden="true"><GIcon size={24} strokeWidth={1.75} /></i>
                  <span className="gtext"><span className="glabel">{g.label}</span></span>
                </span>
                {ANSWERS.map(r => (
                  <button key={r.k} type="button" className={`gbtn gb-${r.k}`} aria-pressed={st === r.k} aria-label={`${r.label}: ${g.label}`} onClick={() => tap(g.id, r.k)}>
                    {r.icon}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <div className="cta-wrap sticky">
        <button type="button" className="cta" disabled={!ok} onClick={() => onStart(answers)}>
          {ok ? `Start (${answered} rated)` : 'Love or like a few'}
        </button>
        {nevers.length > 0 && <div className="fine">We’ll never show you {nevers.join(', ')}.</div>}
      </div>
    </div>
  )
}
