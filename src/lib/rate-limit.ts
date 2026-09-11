/**
 * Fixed-window rate limiter on the existing Upstash Redis client.
 *
 * One INCR per request, then EXPIRE NX (sets the window's TTL once). Fails
 * CLOSED: if Redis cannot count, the caller gets a 503 rather than an
 * unlimited endpoint (RULES I8 — a fallback that answers is worse than an
 * error). Both refusals are logged so a sweep shows up in the function logs
 * (RULES L1). Audit 2026-09-11 (swarm audits/wtw): the 4-digit co-watch join
 * and every LLM-backed route had no limit at all.
 */
import { NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'

export interface RateLimitRule {
  /** Namespace for the counter, e.g. "cowatch-join". */
  scope: string
  /** Max requests per window for the user key. */
  perUser: number
  /** Max requests per window for the IP key (0 = no IP key). */
  perIp?: number
  /** Window length in seconds. */
  windowSec: number
}

/** First hop of X-Forwarded-For (set by Vercel), else a stable fallback. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

async function hit(key: string, max: number, windowSec: number): Promise<boolean> {
  const redis = getRedis()
  const n = await redis.incr(key)
  // NX on every hit, not just n === 1: if the first EXPIRE failed after the
  // INCR landed, the key would otherwise never expire and lock the caller out
  // for good. NX leaves an existing TTL alone, so the window doesn't slide.
  await redis.expire(key, windowSec, 'NX')
  return n <= max
}

/**
 * Returns null when the request may proceed, otherwise the response to send
 * (429 with Retry-After, or 503 when the limiter itself is down).
 */
export async function enforceRateLimit(
  req: Request,
  userId: string,
  rule: RateLimitRule,
): Promise<NextResponse | null> {
  const ip = clientIp(req)
  try {
    const userOk = await hit(`rl:${rule.scope}:u:${userId}`, rule.perUser, rule.windowSec)
    const ipOk = rule.perIp ? await hit(`rl:${rule.scope}:ip:${ip}`, rule.perIp, rule.windowSec) : true
    if (userOk && ipOk) return null
    console.warn(`[rate-limit] ${rule.scope}: refused user=${userId} ip=${ip} (${userOk ? 'ip' : 'user'} window)`)
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rule.windowSec) } },
    )
  } catch (err) {
    console.error(`[rate-limit] ${rule.scope}: limiter unavailable, refusing:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '30' } })
  }
}
