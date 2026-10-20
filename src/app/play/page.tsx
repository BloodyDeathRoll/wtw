/**
 * /play — the taste games (docs/taste-games-handoff.md).
 *
 * Inside the app's own frame (gradient, particles, menu) since 2026-10-20.
 * Nothing here writes the taste DNA yet. Progress lives in play_state /
 * play_events (migration 0024), or in the browser until that migration runs.
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { countUserSignals } from '@/lib/welcome'
import AppShell from '@/modules/session/components/AppShell'
import type { AppUser } from '@/modules/session/types'
import { loadPlay } from './lib/server'
import { withBlindPlots, withSideClues } from './lib/games'
import type { GameTitle, SideClue } from './lib/scales'
import rawTitles from './data/titles.json'
import plotRewrites from './data/plot-rewrites.json'
import otherClues from './data/other-clues.json'
import PlayApp from './components/PlayApp'

export const dynamic = 'force-dynamic'

const titles = withSideClues(withBlindPlots(rawTitles as GameTitle[], plotRewrites), otherClues as Record<string, SideClue[]>)

const DEMO_USER: AppUser = { id: 'dev-demo', email: null, name: null, avatarUrl: null }

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ demo?: string; jump?: string; tab?: string; new?: string; heard?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const params = await searchParams
  // ?tab=games: the home screen's Games button opens the arcade, not the training.
  const tab = params.tab === 'games' ? 'games' : undefined
  // Brand-new users hear the voice intro first, unless the home screen just played it.
  const heard = params.heard === '1'

  // Local dev only: /play?demo=1 runs signed out, saving in the browser, so
  // the games can be clicked through without a Google sign-in. Dead code in
  // any production build (NODE_ENV is 'production' there).
  if (!user && process.env.NODE_ENV === 'development' && params.demo === '1') {
    // &jump=14 starts a ready-made player at that step (lib/demo.ts), replacing the browser save.
    const jumpTo = Number(params.jump) || undefined
    return <PlayApp user={DEMO_USER} existingUser={params.new !== '1'} voiceIntro={params.new === '1' && !heard} titles={titles} saved={{ mode: 'local', state: null, version: 0 }} jumpTo={jumpTo} tab={tab} />
  }

  if (!user) {
    // Deliberately no new sign-in flow here: sign-in returns to the home page,
    // and changing that is shared auth code the live app depends on.
    return (
      <AppShell>
        <div className="phone">
          <div className="screen">
            <div className="intro">
              <div className="brand"><i />WTW</div>
              <h2>Sign in to play</h2>
              <p>Sign in on the home page, then come back to this page.</p>
              <Link className="cta" href="/" style={{ textAlign: 'center', textDecoration: 'none' }}>Go to sign in</Link>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  const appUser: AppUser = {
    id: user.id,
    email: user.email ?? null,
    name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? (user.user_metadata?.picture as string | undefined) ?? null,
  }
  // Brand-new users get a short menu: the feed, ratings and DNA have nothing to show yet.
  const [saved, signals] = await Promise.all([loadPlay(supabase, user.id), countUserSignals(supabase, user.id)])

  return <PlayApp user={appUser} existingUser={signals > 0} voiceIntro={signals === 0 && !heard} titles={titles} saved={saved} tab={tab} />
}
