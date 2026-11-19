import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadDNA } from '@/modules/dna/lib/load-save'
import { loadChatReady } from '@/lib/home-bootstrap'
import { navTabsEnabled } from '@/lib/flags'
import { feedbackConfigured } from '@/lib/feedback'
import AppShell from '@/modules/session/components/AppShell'
import { TabBar } from '@/app/components/TabBar'
import { DnaHeader } from '../profile/dna/DnaHeader'
import { DnaFrame } from '../profile/dna/DnaFrame'
import { TastePage } from '../profile/dna/TastePage'
import { loadTastePage, type TastePageData } from '../profile/dna/lib/taste-page'
import { SeenCard, YouLinksCard } from './YouCards'
import styles from '../profile/dna/dna.module.css'

export const metadata = { title: 'You — WTW' }

/**
 * The You tab (NAV_TABS; docs/prototypes/nav/4-you.jpg, Eran 2026-11-15): the person, then a card for each part of
 * My taste (how WTW sees you · the people who pull you in · the genres in your feed), each with a taste of what's in
 * it and a "See all" into My taste; then Seen (today's ratings page), and last one card of two rows: Send us feedback
 * and Account › (v3 Y1, YOU.md DEC-3, you-v3/1-account-row.jpg). Account is its own page (/you/account).
 */
export default async function YouRoute() {
  if (!navTabsEnabled()) redirect('/profile/dna')
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const appUser = {
    id: user.id,
    email: user.email ?? null,
    name:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      null,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ??
      (user.user_metadata?.picture as string | undefined) ??
      null,
  }

  const chatReady = loadChatReady(supabase, user.id)
  let data: TastePageData | null = null
  try {
    data = await loadTastePage(await loadDNA(user.id), user.id)
  } catch (err) {
    console.error('[you] taste page failed:', err instanceof Error ? err.message : err)
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  // v3 DEC-4 (YOU.md): the ratings count only; "picks" now means For you's 20.
  const subtitle = data ? `${plural(data.ratings, 'rating')}` : ''

  return (
    <AppShell tabs={<TabBar active="you" user={appUser} />}>
      <main className={styles.page}>
        <DnaFrame header={<DnaHeader user={appUser} subtitle={subtitle} title={appUser.name ?? 'You'} chatReady={await chatReady} you />}>
          <div className={styles.container}>
            {data ? (
              <TastePage data={data} variant="you">
                <SeenCard seen={data.seen} total={data.ratings} />
                <YouLinksCard feedback={feedbackConfigured()} />
              </TastePage>
            ) : (
              <>
                <p className={styles.note}>Couldn’t load your taste right now. Try again in a moment.</p>
                <YouLinksCard feedback={feedbackConfigured()} />
              </>
            )}
          </div>
        </DnaFrame>
      </main>
    </AppShell>
  )
}
