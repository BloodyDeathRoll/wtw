'use client'
/**
 * P2-U4 · The quick picks' screens, as signed off in P2-U0 (docs/prototypes/first-run/: `4-this-or-that`,
 * `4-pair-*`, `6-done-*`, `7-skip-2-pair`, `7-skip-3-sheet`, `8-save-2-pair`). The rules live in
 * ../lib/quick-picks.ts and ../lib/showtime.ts; OnboardingApp drives them.
 */
import { useLayoutEffect } from 'react'
import { EyeOff } from 'lucide-react'
import { FingerprintLoader } from '@/modules/session/components/FingerprintLoader'
import { Poster, SaveRibbon, ShareButton } from '@/app/play/components/ui'
import type { Ctl } from '@/app/play/components/types'
import type { Pair, Title } from '@/app/play/lib/brain'
import { QUICK_PICKS, type Side, type SwapNote } from '../lib/quick-picks'
import { SAVE_NOTE } from './CardsStep'

const NOTE: Record<Exclude<SwapNote, null | 'no-swaps'>, string> = {
  'swapped': 'Swapped in something similar.',
  'last-swap': 'Swapped again: the last swap on this side.',
}

function PairSide({ ctl, t, off, onPick, onUnseen }: { ctl: Ctl; t: Title; off: boolean; onPick: () => void; onUnseen: () => void }) {
  return (
    <div className="side">
      <SaveRibbon ctl={ctl} t={t} from="onboarding" />
      <ShareButton ctl={ctl} t={t} />
      <button type="button" className="pick" onClick={onPick}>
        <Poster t={t} />
        <div><div className="nm">{t.title}</div><div className="yr">{t.year}</div></div>
      </button>
      <button type="button" className="unseen ol" disabled={off} onClick={onUnseen}>
        <EyeOff size={18} strokeWidth={2} aria-hidden="true" />Haven’t seen
      </button>
    </div>
  )
}

/**
 * Too tall for the phone (very long titles on a small screen): both posters shrink by the same amount, keeping
 * their shape and their left edge, until "Can't decide" fits; titles, buttons and columns keep their width, and
 * the + and share buttons move with the poster's corner. Normal pairs don't change.
 */
function useFit(screen: React.RefObject<HTMLDivElement | null>, key: string) {
  useLayoutEffect(() => {
    const s = screen.current
    if (!s) return
    const sides = [...s.querySelectorAll<HTMLElement>('.duel .side')]
    const btn = s.querySelector<HTMLElement>(':scope > .actions')
    if (sides.length !== 2 || !btn) return
    const reset = () => sides.forEach(side => {
      for (const el of side.querySelectorAll<HTMLElement>('.poster, .rib, .shc')) el.removeAttribute('style')
    })
    reset()
    const cw = sides[0].clientWidth
    const bottom = () => btn.getBoundingClientRect().bottom - s.getBoundingClientRect().top
    let w = cw
    while (bottom() > s.clientHeight + 0.5 && w > cw * 0.6) {
      w -= 2
      const g = `${cw - w + 8}px`
      for (const side of sides) {
        side.querySelector<HTMLElement>('.poster')!.style.width = `${w}px`
        side.querySelector<HTMLElement>('.rib')!.style.right = g
        const sh = side.querySelector<HTMLElement>('.shc')!
        sh.style.right = g
        sh.style.top = `${w * 1.5 - 46}px`
      }
    }
  }, [screen, key])
}

export function PairScreen({ top, ctl, pair, picks, off, note, onPick, onUnseen, onCantDecide, saveFailed, screenRef }: {
  top: React.ReactNode; ctl: Ctl; pair: Pair; picks: number; off: Record<Side, boolean>; note: SwapNote
  onPick: (s: Side) => void; onUnseen: (s: Side) => void; onCantDecide: () => void; saveFailed: boolean
  screenRef: React.RefObject<HTMLDivElement | null>
}) {
  useFit(screenRef, `${pair.a.id}|${pair.b.id}`)
  const sub = note && note !== 'no-swaps'
    ? <p className="learned">{NOTE[note]}</p>
    : <p>{off.a && off.b ? 'No more swaps. Go with your gut.' : 'Tap a poster.'}</p>
  return (
    <div className="screen game-screen ob-pair" ref={screenRef}>
      {top}
      <div className="seasonbar quiet" role="progressbar" aria-valuemin={0} aria-valuemax={QUICK_PICKS} aria-valuenow={picks}>
        <span className="sb-bar"><i style={{ width: `${(picks / QUICK_PICKS * 100).toFixed(1)}%` }} /></span>
      </div>
      <div className="blockbar"><span>Quick picks</span><span className="lcount"><b>{picks}</b> of {QUICK_PICKS}</span></div>
      <i className="ob-sp1" />
      <div className="prompt"><h2>Which would you rather watch?</h2>{sub}</div>
      <div className="duel">
        <PairSide key={pair.a.id} ctl={ctl} t={pair.a} off={off.a} onPick={() => onPick('a')} onUnseen={() => onUnseen('a')} />
        <PairSide key={pair.b.id} ctl={ctl} t={pair.b} off={off.b} onPick={() => onPick('b')} onUnseen={() => onUnseen('b')} />
      </div>
      <i className="ob-sp2" />
      <div className="actions"><button type="button" className="ghost" onClick={onCantDecide}>Can’t decide</button></div>
      {saveFailed && SAVE_NOTE}
    </div>
  )
}

/** "Skip the picks?": the season's confirmation sheet; it ends the onboarding, so it asks first. */
export function SkipSheet({ onKeep, onSkip, closing }: { onKeep: () => void; onSkip: () => void; closing: boolean }) {
  return (
    <>
      <div className={`sheet-bg ob-sheet-bg${closing ? ' closing' : ''}`} onClick={onKeep} />
      <div className={`sheet confirm ob-sheet${closing ? ' closing' : ''}`} role="alertdialog" aria-labelledby="ob-skip-h">
        <h3 id="ob-skip-h">Skip the picks?</h3>
        <p>Your first matches will be less sharp without them. You can keep rating titles in the feed anytime.</p>
        <button type="button" className="cta" onClick={onKeep}>Keep picking</button>
        <button type="button" className="opt" onClick={onSkip}>Skip</button>
      </div>
    </>
  )
}

/** "It's Showtime": rays, their picks fanned (the newest in the middle with the gold ring), the feed's loader. */
export function ShowtimeScreen({ top, fan, state, onRetry, screenRef }: {
  top: React.ReactNode; fan: Title[]; state: 'wait' | 'slow' | 'failed'; onRetry: () => void
  screenRef: React.Ref<HTMLDivElement>
}) {
  const failed = state === 'failed'
  return (
    <div className="screen game-screen ob-showtime" ref={screenRef}>
      {top}
      <div className="learn va2 between done d-mix">
        <div className="bmid">
          {!failed && <div className="rays spin" />}
          {fan.length > 0 && (
            <div className="lfan dpicks">
              {fan.map(t => <div key={t.id} className="lfan-p"><Poster t={t} size="w185" /></div>)}
            </div>
          )}
          <h2 className="dbig">{failed ? 'Almost showtime' : 'It’s Showtime'}</h2>
          <p>{failed ? 'We couldn’t load your matches.' : 'Finding your first matches.'}</p>
          {!failed && <div className="dfp"><FingerprintLoader size={66} color="#ffffff" /></div>}
          {state === 'slow' && <p className="dnote">Still working. The first time takes a little longer.</p>}
        </div>
        {failed && <button type="button" className="cta" onClick={onRetry}>Try again</button>}
      </div>
    </div>
  )
}

