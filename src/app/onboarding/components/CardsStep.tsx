'use client'
/**
 * P2-U3 · The rating cards' screens, as signed off in P2-U0 (docs/prototypes/first-run/: `2-card-*`, `2-msg-*`,
 * `3-between-*`, `7-skip-1-card`, `8-save-1-card`). The rules live in ../lib/cards.ts; OnboardingApp drives them.
 */
import { useEffect, useRef } from 'react'
import { EyeOff } from 'lucide-react'
import { Poster, SaveRibbon, ShareButton } from '@/app/play/components/ui'
import type { Ctl } from '@/app/play/components/types'
import type { Title } from '@/app/play/lib/brain'
import { SETUP_TOTAL, TARGET, betweenCopy, type CardsState, type Message, type Rating } from '../lib/cards'

const TILES: { r: Rating; e: string; l: string }[] = [
  { r: 'loved', e: '❤️', l: 'Loved' }, { r: 'liked', e: '👍', l: 'Liked' }, { r: 'disliked', e: '👎', l: 'Disliked' },
]
const EMOJI: Record<Rating, string> = { loved: '❤️', liked: '👍', disliked: '👎' }
/** Past this many characters a title would take 3 lines at 26px on a 360px phone, so it drops to 22px. */
const LONG_TITLE = 32

export const SAVE_NOTE = <div className="save-note obs">Couldn’t save. We’ll retry on your next answer.</div>

export function SkipButton({ onSkip }: { onSkip: () => void }) {
  return <button type="button" className="tb-skip" onClick={onSkip}>Skip</button>
}

/** The thin set-up bar (30 ratings + 12 picks) and the step row under it. */
function Progress({ rated, milestone }: { rated: number; milestone: string | null }) {
  return (
    <>
      <div className={`seasonbar quiet${milestone ? ' lmile-bar' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={TARGET} aria-valuenow={rated}>
        <span className="sb-bar"><i style={{ width: `${(rated / SETUP_TOTAL * 100).toFixed(1)}%` }} /></span>
      </div>
      <div className="blockbar">
        {milestone ? <span className="lmile" key={milestone}>{milestone}</span> : <span>Rate what you’ve seen</span>}
        <span className="lcount"><b>{rated}</b> of {TARGET}</span>
      </div>
    </>
  )
}

const meta = (t: Title) => [t.year, t.creators.join(', ')].filter(Boolean).join(' · ')

export function CardScreen({ top, ctl, t, rated, milestone, onAnswer, note, screenRef }: {
  top: React.ReactNode; ctl: Ctl; t: Title; rated: number; milestone: string | null
  onAnswer: (r: Rating | 'unseen') => void; note: boolean; screenRef: React.Ref<HTMLDivElement>
}) {
  return (
    <div className="screen game-screen ob-cards" ref={screenRef}>
      {top}
      <Progress rated={rated} milestone={milestone} />
      <div className="learn va2">
        <div className="reveal-poster learn-poster">
          <Poster t={t} size="w500" />
          <SaveRibbon ctl={ctl} t={t} from="onboarding" />
          <ShareButton ctl={ctl} t={t} />
        </div>
        <h2 className={t.title.length > LONG_TITLE ? 'long' : undefined}>{t.title}</h2>
        <div className="lmeta">{meta(t)}</div>
        <div className="lfill" />
        <div className="ltiles three">
          {TILES.map(x => (
            <button key={x.r} type="button" className="ltile" onClick={() => onAnswer(x.r)}>
              <span className="seen-emoji">{x.e}</span><span>{x.l}</span>
            </button>
          ))}
        </div>
        <button type="button" className="unseen ol" onClick={() => onAnswer('unseen')}>
          <EyeOff size={18} strokeWidth={2} aria-hidden="true" />Haven’t seen
        </button>
      </div>
      {note && SAVE_NOTE}
    </div>
  )
}

export function MessageScreen({ top, m, rated, fan, onKeepGoing, onToPicks, note, screenRef }: {
  top: React.ReactNode; m: Message; rated: number; fan: Title[]
  onKeepGoing: () => void; onToPicks: () => void; note: boolean; screenRef: React.Ref<HTMLDivElement>
}) {
  const head = m === 1 ? 'Lots of new ones?' : 'Not seen many of these?'
  const line = m === 1
    ? 'No problem. Tap “Haven’t seen” as often as you need. We stop as soon as you’ve rated 30.'
    : `You’ve rated ${rated} so far. Keep looking, or go on to 12 quick picks. Those work even with titles you haven’t seen.`
  return (
    <div className="screen game-screen ob-cards" ref={screenRef}>
      {top}
      <Progress rated={rated} milestone={null} />
      <div className="learn va2 lmsg-screen">
        <div className="lmsg">
          <div className="lfan">
            {fan.map(t => (
              <div key={t.id} className="lfan-p"><Poster t={t} size="w185" /><i><EyeOff size={16} strokeWidth={2} aria-hidden="true" /></i></div>
            ))}
          </div>
          <h2>{head}</h2>
          <p>{line}</p>
        </div>
        <div className="lfill" />
        <div className="lmsg-btns">
          {m === 1
            ? <button type="button" className="cta" onClick={onKeepGoing}>Keep going</button>
            : <>
                <button type="button" className="cta" onClick={onKeepGoing}>Keep looking</button>
                <button type="button" className="opt" onClick={onToPicks}>Go to quick picks</button>
              </>}
        </div>
      </div>
      {note && SAVE_NOTE}
    </div>
  )
}

/**
 * The poster row: one row that runs off the right edge and scrolls sideways, snapping to the content edge. The
 * fades follow the scroll: 70px on the right while more wait there, 40px on the left once some have gone.
 */
function PosterRow({ items, badges }: { items: { t: Title; r: Rating }[]; badges: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const r = ref.current
    if (!r) return
    const upd = () => {
      const m = r.scrollWidth - r.clientWidth
      r.classList.toggle('fl', r.scrollLeft > 2)
      r.classList.toggle('fr', r.scrollLeft < m - 2)
    }
    upd()
    r.addEventListener('scroll', upd, { passive: true })
    window.addEventListener('resize', upd)
    return () => { r.removeEventListener('scroll', upd); window.removeEventListener('resize', upd) }
  }, [items.length])
  return (
    <div className="brow" ref={ref}>
      {items.map(({ t, r }) => (
        <div key={t.id} className="bw-p">
          <Poster t={t} size="w185" />
          {badges && <span className="bw-e" aria-label={r}>{EMOJI[r]}</span>}
        </div>
      ))}
    </div>
  )
}

export function BetweenScreen({ top, cards, byId, onStart, note, screenRef }: {
  top: React.ReactNode; cards: CardsState; byId: Map<string, Title>; onStart: () => void; note: boolean
  screenRef: React.Ref<HTMLDivElement>
}) {
  const c = betweenCopy(cards)
  const items = c.posters.map(p => ({ t: byId.get(p.id), r: p.r })).filter((x): x is { t: Title; r: Rating } => !!x.t)
  return (
    <div className="screen game-screen ob-between" ref={screenRef}>
      {top}
      <div className="learn va2 between">
        <div className="bmid">
          <h2>{c.head}</h2>
          <p>{c.line}</p>
          {c.label && items.length > 0 && <><h4 className="blabel">{c.label}</h4><PosterRow items={items} badges={c.badges} /></>}
          <div className="learned-box bnext">
            <h4><b>Last step:</b> 12 quick picks</h4>
            <ul>
              <li>Two titles at a time. Tap the one you’d rather watch.</li>
              <li>Then you’re done.</li>
            </ul>
          </div>
        </div>
        <button type="button" className="cta" onClick={onStart}>Start the picks</button>
      </div>
      {note && SAVE_NOTE}
    </div>
  )
}
