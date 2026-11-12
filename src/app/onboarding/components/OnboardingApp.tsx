'use client'
/**
 * The new first run's steps (P2-U2 … U4). Built so far: the genre step. The rating cards (#244) and the quick
 * picks (#245) come next; until then Start saves and shows where they will go.
 */
import { useState } from 'react'
import AppShell from '@/modules/session/components/AppShell'
import type { AppUser } from '@/modules/session/types'
import { usePersistence } from '@/app/play/components/persist'
import type { SavedPlay } from '@/app/play/lib/server'
import OnboardingTop from './OnboardingTop'
import GenreStep from './GenreStep'
import { applyGenreStep, type GenreAnswers } from '../lib/genre-step'

export default function OnboardingApp({ user, saved }: { user: AppUser; saved: SavedPlay }) {
  const { save, flushNow } = usePersistence(user.id, saved.mode, saved.version)
  const [step, setStep] = useState(saved.state?.onboarding?.step ?? 'genres')
  const top = <OnboardingTop user={user} />

  const startCards = async (answers: GenreAnswers) => {
    const S = applyGenreStep(saved.state, answers)
    save(S, [{ kind: 'onboarding_genres', payload: { genres16: answers } }])
    await flushNow()
    setStep('cards')
  }

  return (
    <AppShell>
      <div className="phone">
        {step === 'genres'
          ? <GenreStep top={top} onStart={startCards} />
          : (
            <div className="screen">
              {top}
              <div className="learn va2 between"><div className="bmid">
                <h2>Genres saved.</h2>
                <p>The rating cards come next. They aren’t built yet (#244).</p>
              </div></div>
            </div>
          )}
      </div>
    </AppShell>
  )
}
