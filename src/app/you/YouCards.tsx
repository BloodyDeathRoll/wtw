'use client'
/** The You tab's own cards, after the taste ones: Seen (your ratings) and Sign out. */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { TastePageData } from '../profile/dna/lib/taste-page'
import base from '../profile/dna/dna.module.css'
import t from '../profile/dna/taste.module.css'
import s from './you.module.css'

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

export function SignOutCard() {
  const router = useRouter()
  return (
    <section className={base.section}>
      <button
        type="button"
        className={s.signOut}
        onClick={async () => {
          await createClient().auth.signOut()
          router.replace('/login')
          router.refresh()
        }}
      >
        <LogOut size={22} strokeWidth={1.5} aria-hidden />
        Sign out
      </button>
    </section>
  )
}
