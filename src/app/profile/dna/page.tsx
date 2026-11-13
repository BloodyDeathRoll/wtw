import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadDNA } from '@/modules/dna/lib/load-save'
import AppShell from '@/modules/session/components/AppShell'
import { DnaHeader } from './DnaHeader'
import { DnaFrame } from './DnaFrame'
import { TastePage } from './TastePage'
import { loadTastePage, type TastePageData } from './lib/taste-page'
import styles from './dna.module.css'

export const metadata = { title: 'My taste — WTW' }

/**
 * My taste (P2-U8, rebuilt for the v2 formula; signed off on the playable prototype, Eran 2026-11-13). What the app
 * thinks you like, in the terms that move the feed: the taste model's leans, the people you keep coming back to, and
 * your ratings on the 16 genres with your call on each. Story traits and mood & pace weigh nothing in v2 and left the
 * page; so did the rules list (a rule is now a genre's call) and stretch-pick results.
 */
export default async function TastePageRoute() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const appUser = {
    id: user.id,
    email: user.email ?? null,
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }

  let data: TastePageData | null = null
  try {
    data = await loadTastePage(await loadDNA(user.id), user.id)
  } catch (err) {
    console.error('[profile/dna] taste page failed:', err instanceof Error ? err.message : err)
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  // "updated 13 Nov" doesn't fit beside the search and menu buttons on a phone, and the page is always current.
  const subtitle = data ? `${plural(data.ratings, 'rating')} · ${plural(data.picks, 'pick')}` : ''

  return (
    <AppShell>
      <main className={styles.page}>
        <DnaFrame header={<DnaHeader user={appUser} subtitle={subtitle} title="My taste" />}>
          <div className={styles.container}>
            {data ? <TastePage data={data} /> : <p className={styles.note}>Couldn’t load your taste right now. Try again in a moment.</p>}
          </div>
        </DnaFrame>
      </main>
    </AppShell>
  )
}
