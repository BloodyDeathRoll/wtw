/**
 * Local demo only (/play?demo=1&jump=N): a ready-made player at step N, so
 * the final round and the reveal can be tried without replaying the season.
 * A simulated player with a consistent taste (likes it lighter, faster and a
 * bit twisty; loves drama and comedy) makes the season's ~56 picks, so the
 * brain has really learned someone by the time the jump lands.
 */
import { CORE_SCALES } from './scales'
import { choose, freshState, nextPair, type Pair, type PlayState, type Title } from './brain'
import { SEASON_LENGTH } from './blocks'

const TASTE: Record<string, number> = { tone: 0.8, energy: 0.3, pace: 0.6, dark: -0.4, complex: 0.5, fantastic: 0.1, modern: 0.2, indie: -0.2 }
const DEMO_PICKS = 56

function seeded(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
}

export function demoStateAt(T: Title[], step: number): PlayState {
  const rand = seeded(2026)
  const S = freshState()
  S.format = 'both'
  S.gen.drama = 2; S.gen.comedy = 2; S.gen.action = 1
  S.sel = ['drama', 'comedy', 'action']
  S.loved = ['drama', 'comedy']
  const like = (t: Title) => CORE_SCALES.reduce((s, a) => s + (t.scales[a] ?? 0) * (TASTE[a] ?? 0), 0) + (rand() - 0.5) * 1.6
  for (let i = 0; i < DEMO_PICKS; i++) {
    const p: Pair | null = nextPair(S, T, {}, rand)
    if (!p) break
    choose(S, p, like(p.a) >= like(p.b) ? 'a' : 'b')
  }
  S.block = Math.max(2, Math.min(SEASON_LENGTH + 1, Math.round(step)))
  S.blockPicks = 0
  S.blockTally = {}
  S.blockChosen = []
  S.log.unshift(`Demo: jumped to step ${S.block} after ${S.round} simulated picks`)
  return S
}
