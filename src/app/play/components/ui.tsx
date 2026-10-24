'use client'
/* Shared pieces of the taste-games screens: poster, meter, scale row, icons, the header. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AppMenu, VOICES, type MenuItem, type Voice } from '@/modules/session/components/AppMenu'
import { seasonDone } from '../lib/blocks'
import { SCALE_LABELS, type Scale } from '../lib/scales'
import { conf, est, type PlayState, type Title } from '../lib/brain'
import type { SaveSource } from '../lib/watchlist'
import type { Ctl } from './types'

/**
 * The watchlist ribbon on a poster's corner (Eran picked the ribbon,
 * docs/prototypes/watchlist/w1-styles.jpg). Its parent must be position:relative;
 * it sits beside the pick button, never inside it, so saving never picks.
 */
/** Renders `*word*` markers as highlighted words. */
export function Marked({ text }: { text: string }) {
  return <>{text.split('*').map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))}</>
}

export function SaveRibbon({ ctl, t, from }: { ctl: Ctl; t: Title; from: SaveSource }) {
  const on = ctl.isSaved(t.id)
  return (
    <button type="button" className={`rib${on ? ' on' : ''}`} aria-pressed={on}
      aria-label={on ? `Remove ${t.title} from your watchlist` : `Add ${t.title} to your watchlist`}
      onClick={e => { e.stopPropagation(); ctl.toggleSave(t, from) }}>
      <span aria-hidden="true">{on ? '✓' : '+'}</span>
    </button>
  )
}

export function Poster({ t, dim, qm, size = 'w342' }: { t: Title; dim?: boolean; qm?: boolean; size?: 'w185' | 'w342' | 'w500' }) {
  return (
    <div className={`poster real${dim ? ' dim' : ''}`}>
      {t.poster_path
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP; next/image would proxy it
        ? <img src={`https://image.tmdb.org/t/p/${size}${t.poster_path}`} alt="" loading="lazy" />
        : <div className="pt">{t.title}</div>}
      {t.type === 'tv' && <span className="tvb">SERIES</span>}
      {qm && <span className="qm">?</span>}
    </div>
  )
}

export function AxisRow({ S, a }: { S: PlayState; a: Scale }) {
  const e = est(S, a), c = conf(S, a)
  const lean = c > 0.35 && Math.abs(e) > 0.25 ? (e > 0 ? 'lean-r' : 'lean-l') : ''
  return (
    <div className={`axis ${lean}`}>
      <span className="l">{SCALE_LABELS[a][0]}</span>
      <div className="track"><span className="dot" style={{ left: `${50 + e * 46}%`, opacity: +(0.15 + c * 0.85).toFixed(2) }} /></div>
      <span className="r">{SCALE_LABELS[a][1]}</span>
    </div>
  )
}

export function Stars({ n, you }: { n: number; you?: boolean }) {
  return <span className={you ? 'you-stars' : ''}>{[1, 2, 3, 4, 5].map(i => <span key={i} className={`st${i <= n ? ' on' : ''}`}>★</span>)}</span>
}

const svg = (d: React.ReactNode, fill = false) => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)

export const Icon = {
  menu: svg(<path d="M4 7h16M4 12h16M4 17h16" />),
  x: svg(<path d="M6 6l12 12M18 6L6 18" />),
  q: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01" /></>),
  tonight: svg(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />),
  train: svg(<><rect x="3" y="5" width="7" height="14" rx="2" /><rect x="14" y="5" width="7" height="14" rx="2" /></>),
  games: svg(<><rect x="2.5" y="7" width="19" height="11" rx="5" /><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01" /></>),
  me: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
  list: svg(<path d="M6 3h12v18l-6-4-6 4z" />),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>),
  love: svg(<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21z" />, true),
  like: svg(<path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.8 1.3 2.5 3L13 9h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.1 20H7" />),
  never: svg(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>),
}

/** Same key WTWApp keeps the Gemini Live voice under. */
const VOICE_KEY = 'wtw:voice'
const NOTHING_YET: MenuItem[] = ['recommend', 'watchlist', 'play', 'ratings', 'profile', 'voice']
const NEW_USER: MenuItem[] = ['recommend', 'ratings', 'profile']

/**
 * The app's header on every games screen (2026-10-20): Skip or back on the
 * left, the app's own menu on the right. Before the genres are rated the menu
 * offers only Sign out; a brand-new user's menu stays short (no feed, ratings
 * or DNA to show yet) until they finish or skip the season.
 */
export function TopBar({ ctl }: { ctl: Ctl }) {
  const { S } = ctl
  const router = useRouter()
  // Read once on the client; the voice only shows inside the open menu, so
  // the server's default never reaches the screen.
  const [voice, setVoice] = useState<Voice>(() => {
    try {
      const v = typeof window === 'undefined' ? null : localStorage.getItem(VOICE_KEY)
      if (v && VOICES.some(o => o.id === v)) return v as Voice
    } catch { /* storage off */ }
    return VOICES[0].id
  })
  const chooseVoice = (v: Voice) => {
    setVoice(v)
    try { localStorage.setItem(VOICE_KEY, v) } catch { /* the choice just won't outlive the page */ }
  }
  const settled = seasonDone(S) || !!S.skipped
  const hide = !S.sel ? NOTHING_YET : !ctl.existingUser && !settled ? NEW_USER : []
  const go = (stage: string) => () => ctl.leave(`/?stage=${stage}`)
  const left = ctl.canSkip
    ? <button className="tb-skip" onClick={() => ctl.ask('skip')}>Skip</button>
    : S.sel && !ctl.inTraining && !hide.includes('recommend')
      ? <button className="tb-back" onClick={() => ctl.leave('/?from=play')} aria-label="Back to home"><ChevronLeft size={30} strokeWidth={1.5} aria-hidden="true" /></button>
      : null
  return (
    <div className="apptop">
      <div className="tb-l">{left}</div>
      <div className="brand app-brand"><Image src="/logo_vector.svg" alt="" width={56} height={56} />WTW</div>
      <div className="tb-r">
        <AppMenu
          onRecommend={go('recommendations')}
          onWatchlist={go('watchlist')}
          onFastLearning={() => ctl.go('games')}
          onRatings={go('ratings')}
          onProfile={() => ctl.leave('/profile/dna')}
          user={ctl.user}
          onSignOut={async () => {
            await createClient().auth.signOut()
            router.replace('/login')
            router.refresh()
          }}
          voice={voice}
          setVoice={chooseVoice}
          hide={hide}
        />
      </div>
    </div>
  )
}
