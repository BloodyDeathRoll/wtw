/**
 * /onboarding — the new first run (P2-U2 … U6, designed in #241: docs/prototypes/first-run/).
 *
 * Behind `ONBOARDING_V2` (src/lib/flags.ts): off, the page exists only in local development, for building and
 * checking it. On, `/` sends new users here until they're done (P2-U6, src/lib/onboarding-route.ts). Progress lives in the same play_state row as the games
 * (`state.onboarding`), saved through /api/play/state.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadHomeBootstrap } from '@/lib/home-bootstrap'
import { onboardingV2Enabled } from '@/lib/flags'
import { needsOnboarding } from '@/lib/onboarding-route'
import type { AppUser } from '@/modules/session/types'
import OnboardingApp from './components/OnboardingApp'
import rawTitles from '@/app/play/data/titles.json'
import type { GameTitle } from '@/app/play/lib/scales'

// The 980 game titles: the cards are drawn from them, and the quick picks pick from them (#245).
const titles = rawTitles as GameTitle[]

export const dynamic = 'force-dynamic'

const DEMO_USER: AppUser = { id: 'dev-demo', email: null, name: null, avatarUrl: null }

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  if (!onboardingV2Enabled() && process.env.NODE_ENV !== 'development') notFound()

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  // Local dev only, as /play?demo=1: signed out, saving in this browser, so the steps can be clicked through
  // without a sign-in and without writing to any account. Dead code in a production build.
  if (!user && process.env.NODE_ENV === 'development' && (await searchParams).demo === '1') {
    return <OnboardingApp user={DEMO_USER} saved={{ mode: 'local', state: null, version: 0 }} titles={titles} />
  }
  if (!user) redirect('/')

  const appUser: AppUser = {
    id: user.id,
    email: user.email ?? null,
    name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? (user.user_metadata?.picture as string | undefined) ?? null,
  }
  const { play: saved, signals } = await loadHomeBootstrap(supabase, user.id)
  // Done, or an existing account that skips it: the feed (the same rule `/` uses, so they never bounce).
  if (onboardingV2Enabled() && !needsOnboarding(saved.state, signals)) redirect('/')
  return <OnboardingApp user={appUser} saved={saved} titles={titles} />
}
