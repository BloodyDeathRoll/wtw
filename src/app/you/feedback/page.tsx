import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadChatReady } from '@/lib/home-bootstrap'
import { navTabsEnabled } from '@/lib/flags'
import { feedbackConfigured } from '@/lib/feedback'
import AppShell from '@/modules/session/components/AppShell'
import { TabBar } from '@/app/components/TabBar'
import { DnaHeader } from '../../profile/dna/DnaHeader'
import { DnaFrame } from '../../profile/dna/DnaFrame'
import { FeedbackForm } from './FeedbackForm'
import styles from '../../profile/dna/dna.module.css'

export const metadata = { title: 'Send us feedback — WTW' }

/**
 * Send us feedback (v3 Y2, docs/plan/v3/YOU.md DEC-5; docs/prototypes/you-v3/3-feedback.jpg, 4-feedback-sent.jpg):
 * its own page, like Account. Back returns to You, the You tab stays lit. Off (back to You) until the team's email
 * service is set up (RESEND_API_KEY, FEEDBACK_TO), as the row on You is.
 */
export default async function FeedbackRoute() {
  if (!navTabsEnabled()) redirect('/profile/dna')
  if (!feedbackConfigured()) redirect('/you')
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
        <DnaFrame header={<DnaHeader user={appUser} subtitle="" title="Send us feedback" chatReady={await loadChatReady(supabase, user.id)} searchFrom="/you/feedback" />}>
          <div className={styles.container}>
            <FeedbackForm />
          </div>
        </DnaFrame>
      </main>
    </AppShell>
  )
}
