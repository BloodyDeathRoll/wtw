/**
 * GET|POST /api/cron/feedback — nightly retry of feedback notes whose email
 * didn't go out (v3 Y2, YOU.md DEC-5 step 5): unsent rows with fewer than 5
 * attempts, oldest first. Protected by CRON_SECRET. Vercel's cron calls GET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, logAuthFailure } from '@/lib/auth-guard'
import { retryUnsent } from '@/lib/feedback'

async function run(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    logAuthFailure('/api/cron/feedback')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const r = await retryUnsent()
    console.log(`[cron/feedback] tried ${r.tried}, sent ${r.sent}`)
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    console.error('[cron/feedback] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export const GET = run
export const POST = run
