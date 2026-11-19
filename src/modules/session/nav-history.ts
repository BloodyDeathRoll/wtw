/**
 * NAV_HISTORY (docs/plan/v3/YOU.md DEC-1): under the tab bar the home route's stage is in the address, so each step is
 * a history entry and the phone's Back finds the stage again. For you is "/"; the rest are "/?stage=…".
 */
const ADDRESSED = ['watchlist', 'conversation', 'ratings', 'learning'] as const
type Addressed = (typeof ADDRESSED)[number] | 'recommendations'

/** The address of a stage, or null for a stage without one (the old home screen's intro, onboard and welcome). */
export function stageHref(stage: string): string | null {
  if (stage === 'recommendations') return '/'
  return (ADDRESSED as readonly string[]).includes(stage) ? `/?stage=${stage}` : null
}

/** The stage an address names, or null when it names none of ours (another route, or an unknown ?stage=). */
export function stageOfAddress(at: { pathname: string; search: string }): Addressed | null {
  if (at.pathname !== '/') return null
  const s = new URLSearchParams(at.search).get('stage')
  if (!s || s === 'recommendations') return 'recommendations'
  return (ADDRESSED as readonly string[]).includes(s) ? (s as Addressed) : null
}
