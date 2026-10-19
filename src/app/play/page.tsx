/**
 * /play — the taste games (docs/taste-games-handoff.md, Slice 1).
 *
 * A hidden route that runs alongside the live app: nothing links here, and
 * nothing here writes the taste DNA. Progress lives in play_state /
 * play_events (migration 0024), or in the browser until that migration runs.
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadPlay } from './lib/server'
import { withBlindPlots, withSideClues } from './lib/games'
import type { GameTitle, SideClue } from './lib/scales'
import rawTitles from './data/titles.json'
import plotRewrites from './data/plot-rewrites.json'
import otherClues from './data/other-clues.json'
import PlayApp from './components/PlayApp'

export const dynamic = 'force-dynamic'

const titles = withSideClues(withBlindPlots(rawTitles as GameTitle[], plotRewrites), otherClues as Record<string, SideClue[]>)

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ demo?: string; jump?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Local dev only: /play?demo=1 runs signed out, saving in the browser, so
  // the games can be clicked through without a Google sign-in. Dead code in
  // any production build (NODE_ENV is 'production' there).
  const params = await searchParams
  if (!user && process.env.NODE_ENV === 'development' && params.demo === '1') {
    // &jump=14 starts a ready-made player at that step (lib/demo.ts), replacing the browser save.
    const jumpTo = Number(params.jump) || undefined
    return <PlayApp userId="dev-demo" firstName={null} titles={titles} saved={{ mode: 'local', state: null, version: 0 }} jumpTo={jumpTo} />
  }

  if (!user) {
    // Deliberately no new sign-in flow here: sign-in returns to the home page,
    // and changing that is shared auth code the live app depends on.
    return (
      <div className="phone">
        <div className="aurora" />
        <div className="screen">
          <div className="intro">
            <div className="brand"><i />WTW</div>
            <h2>Sign in to play</h2>
            <p>Sign in on the home page, then come back to this page.</p>
            <Link className="cta" href="/" style={{ textAlign: 'center', textDecoration: 'none' }}>Go to sign in</Link>
          </div>
        </div>
      </div>
    )
  }

  const saved = await loadPlay(supabase, user.id)
  const firstName = ((user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? '').split(' ')[0] || null

  return (
    <PlayApp
      userId={user.id}
      firstName={firstName}
      titles={titles}
      saved={saved}
    />
  )
}
