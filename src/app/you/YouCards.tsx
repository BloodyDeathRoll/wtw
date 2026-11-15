'use client'
/** The You tab's own cards, after the taste ones: Seen (your ratings) and Account (Sign out, Start my taste over). */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bebas_Neue } from 'next/font/google'
import { ChevronRight, LogOut, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { TastePageData } from '../profile/dna/lib/taste-page'
import base from '../profile/dna/dna.module.css'
import t from '../profile/dna/taste.module.css'
import s from './you.module.css'

/** The games' display face, for the start-over sheet's title (the games' "Start over?" sheet, play/layout.tsx). */
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas' })

const MARK = { loved: '❤️', liked: '👍', disliked: '👎' } as const

/**
 * Seen: what you've rated, counted, and the newest posters with your reaction on each (the onboarding's
 * rated-posters row). "See all" opens today's ratings page, called Seen under the tab bar; its redesign is
 * its own task (docs/BACKLOG.md).
 */
export function SeenCard({ seen, total }: { seen: TastePageData['seen']; total: number }) {
  const { tally, recent } = seen
  return (
    <section className={base.section}>
      <div className={base.sectionHead}>
        <h2 className={`${base.sectionTitle} ${base.sectionTitleAccent}`}>Seen</h2>
        {total > 0 && (
          <Link href="/?stage=ratings" className={t.seeAll}>
            See all {total}
            <ChevronRight size={18} strokeWidth={2.2} aria-hidden />
          </Link>
        )}
      </div>
      {total > 0 ? (
        <>
          <p className={s.count}>{tally.loved} loved · {tally.liked} liked · {tally.disliked} disliked</p>
          <div className={s.row}>
            {recent.map(r => (
              <div key={r.key} className={s.poster} title={r.title}>
                {r.poster
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, as elsewhere on this page
                  ? <img src={`https://image.tmdb.org/t/p/w185${r.poster}`} alt={r.title} loading="lazy" />
                  : <span className={s.noPoster}>{r.title}</span>}
                <span className={s.mark} aria-label={r.reaction}>{MARK[r.reaction]}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className={t.quiet}>Nothing rated yet. Tell the feed what you’ve seen and it shows up here.</p>
      )}
    </section>
  )
}

/**
 * Account (Eran, 2026-11-15; docs/prototypes/games-page/7-you-account.jpg): the account's rows in the genre rows'
 * look, Sign out first, then Start my taste over. Personal details, Contact us and Delete my account join this box
 * later.
 */
export function AccountCard() {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  return (
    <section className={base.section}>
      <div className={base.sectionHead}>
        <h2 className={`${base.sectionTitle} ${base.sectionTitleAccent}`}>Account</h2>
      </div>
      <div className={t.grows}>
        <button
          type="button"
          className={t.grow}
          onClick={async () => {
            await createClient().auth.signOut()
            router.replace('/login')
            router.refresh()
          }}
        >
          <i className={t.gline} aria-hidden="true"><LogOut size={24} strokeWidth={1.75} /></i>
          <span className={t.gtext}><span className={t.glabel} style={{ display: 'block' }}>Sign out</span></span>
          <span />
          <span />
        </button>
        <button type="button" className={t.grow} onClick={() => setAsking(true)}>
          <i className={t.gline} aria-hidden="true"><RotateCcw size={24} strokeWidth={1.75} /></i>
          <span className={t.gtext}>
            <span className={t.glabel} style={{ display: 'block' }}>Start my taste over</span>
            <span className={t.gsays} style={{ display: 'block' }}>Teach WTW your taste from scratch. Your Watchlist and game scores stay.</span>
          </span>
          <span />
          <span className={t.chev}><ChevronRight size={16} strokeWidth={2} /></span>
        </button>
      </div>
      {asking && <StartOverSheet onClose={() => setAsking(false)} />}
    </section>
  )
}

/**
 * "Start your taste over?": the games' "Start over?" sheet (play.css .sheet.confirm), pixel for pixel. Cancel is
 * the main button; Start over, the quieter one, erases (POST /api/account/start-over) and opens `/`, which sends
 * them through the onboarding again.
 */
function StartOverSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<'ask' | 'busy' | 'failed'>('ask')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state !== 'busy') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, state])

  async function startOver() {
    setState('busy')
    try {
      const res = await fetch('/api/account/start-over', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'start-over' }),
      })
      if (!res.ok) throw new Error(String(res.status))
      window.location.assign('/')
    } catch {
      setState('failed')
    }
  }

  return createPortal(
    <div className={bebas.variable}>
      <div className={s.sheetBg} onClick={state === 'busy' ? undefined : onClose} />
      <div className={s.sheet} role="alertdialog" aria-modal="true" aria-labelledby="start-over-h">
        <h3 id="start-over-h">Start your taste over?</h3>
        <p>WTW forgets what it learned about your taste: your ratings, your taste profile, and your answers in the onboarding and the games. You’ll go through the quick onboarding again and your feed starts fresh. Your Watchlist and game scores stay. This can’t be undone.</p>
        {state === 'failed' && <p className={s.sheetError} role="alert">Couldn’t start over just now. Try again in a moment.</p>}
        <button type="button" className={s.sheetCta} autoFocus onClick={onClose} disabled={state === 'busy'}>Cancel</button>
        <button type="button" className={s.sheetOpt} onClick={startOver} disabled={state === 'busy'}>
          {state === 'busy' ? 'Starting over…' : 'Start over'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
