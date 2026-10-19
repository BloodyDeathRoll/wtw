'use client'
/* Shared pieces of the taste-games screens: poster, meter, scale row, icons. */
import { SCALE_LABELS, type Scale } from '../lib/scales'
import { conf, est, type PlayState, type Title } from '../lib/brain'
import type { SaveSource } from '../lib/watchlist'
import type { Ctl } from './types'

/**
 * The watchlist ribbon on a poster's corner (Eran picked the ribbon,
 * docs/prototypes/watchlist/w1-styles.jpg). Its parent must be position:relative;
 * it sits beside the pick button, never inside it, so saving never picks.
 */
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

export function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="topbar">
      <button className="hb" onClick={onMenu} aria-label="Open menu">{Icon.menu}</button>
      <div className="brand"><i />WTW</div>
    </div>
  )
}
