/**
 * Auth-failure logging and the CRON_SECRET bearer check (swarm audit
 * 2026-09-11, RULES L1). A 401 used to return silently, so a credential sweep
 * left nothing in the function logs. Logs the route only — never the header
 * or any user id.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export function logAuthFailure(route: string): void {
  console.warn(`[auth] 401 ${route}`)
}

/**
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time. Both sides
 * are hashed first so timingSafeEqual gets equal lengths and the secret's
 * length is not leaked either. False when CRON_SECRET is unset.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = req.headers.get('authorization') ?? ''
  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(given), digest(`Bearer ${secret}`))
}
