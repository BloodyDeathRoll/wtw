/**
 * POST /api/feedback — "Send us feedback" (v3 Y2, docs/plan/v3/YOU.md DEC-5).
 *
 *   { body }  →  200 { ok: true }                    saved (and emailed, or queued for the nightly retry)
 *             →  400 { error: 'empty' | 'too_long' }
 *             →  401 not signed in
 *             →  429 / 503 the hourly limit, or the limiter is down
 *             →  503 { error: 'unavailable' }         RESEND_API_KEY / FEEDBACK_TO not set
 *             →  500 the note couldn't be saved
 *
 * "Sent" means saved: the email is tried after the response, and a failure
 * leaves emailed_at empty for /api/cron/feedback. Only a failed save, the
 * limit or the missing secrets show the page's red line; nothing typed is
 * lost, since the page keeps the note in the box on any error.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { enforceRateLimit } from '@/lib/rate-limit'
import { FEEDBACK_MAX_CHARS, FEEDBACK_PER_HOUR, emailFeedback, feedbackConfigured, markAttempt } from '@/lib/feedback'

const RULE = { scope: 'feedback', perUser: FEEDBACK_PER_HOUR, windowSec: 60 * 60 }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  // As /api/search: the session token checked locally.
  const { data: auth, error: authErr } = await supabase.auth.getClaims()
  const claims = auth?.claims as { sub?: string; email?: string; user_metadata?: { full_name?: string; name?: string } } | undefined
  if (authErr || !claims?.sub) {
    logAuthFailure('/api/feedback')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!feedbackConfigured()) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  let body: string
  try {
    const json = (await req.json()) as { body?: unknown }
    body = typeof json.body === 'string' ? json.body.trim() : ''
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (!body) return NextResponse.json({ error: 'empty' }, { status: 400 })
  if (body.length > FEEDBACK_MAX_CHARS) return NextResponse.json({ error: 'too_long' }, { status: 400 })

  const limited = await enforceRateLimit(req, claims.sub, RULE)
  if (limited) return limited

  const userAgent = req.headers.get('user-agent')?.slice(0, 300) ?? null
  const { data: row, error } = await createServiceClient()
    .from('feedback')
    .insert({ user_id: claims.sub, body, user_agent: userAgent })
    .select('id, body, created_at, user_agent')
    .single()
  if (error || !row) {
    console.error('[feedback] save failed:', error?.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  const sender = {
    id: claims.sub,
    email: claims.email ?? null,
    name: claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? null,
  }
  after(async () => markAttempt(row.id, await emailFeedback(row, sender), 0))
  return NextResponse.json({ ok: true })
}
