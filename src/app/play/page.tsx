/**
 * /play — the taste games (docs/taste-games-handoff.md).
 *
 * Inside the app's own frame (gradient, particles, menu) since 2026-10-20.
 * Nothing here writes the taste DNA yet. Progress lives in play_state /
 * play_events (migration 0024), or in the browser until that migration runs.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { countUserSignals } from '@/lib/welcome'
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

  // Sign-in comes first (2026-10-20): the home page is the sign-in screen, and
  // a new user lands back there on the voice intro, which leads here.
  if (!user) redirect('/')

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
