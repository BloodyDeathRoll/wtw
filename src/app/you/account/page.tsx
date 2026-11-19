import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadChatReady } from '@/lib/home-bootstrap'
import { navTabsEnabled } from '@/lib/flags'
import AppShell from '@/modules/session/components/AppShell'
import { TabBar } from '@/app/components/TabBar'
import { DnaHeader } from '../../profile/dna/DnaHeader'
import { DnaFrame } from '../../profile/dna/DnaFrame'
import { AccountRows } from '../YouCards'
import styles from '../../profile/dna/dna.module.css'

export const metadata = { title: 'Account — WTW' }

/**
 * Account (v3 Y1, docs/plan/v3/YOU.md DEC-3; docs/prototypes/you-v3/2-account-page.jpg): its own page, like My
 * taste: Back (top left) returns to You, and the You tab stays lit. Start my taste over, then Sign out; Delete my
 * account joins last with v3 Y3. Under the tab bar only, as You is: without it there is no You to come from.
 */
export default async function AccountRoute() {
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

  return (
    <AppShell tabs={<TabBar active="you" atRoot={false} user={appUser} />}>
      <main className={styles.page}>
        <DnaFrame header={<DnaHeader user={appUser} subtitle="" title="Account" chatReady={await loadChatReady(supabase, user.id)} searchFrom="/you/account" />}>
          <div className={styles.container}>
            <AccountRows />
          </div>
        </DnaFrame>
      </main>
    </AppShell>
  )
}
