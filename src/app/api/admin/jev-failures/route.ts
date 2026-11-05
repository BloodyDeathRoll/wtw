/**
 * POST /api/admin/jev-failures — a dev dismissed the Jev failure notice.
 * Body: `{ at: string }`, the ISO time of the newest failure they were shown.
 * Marks the failures seen up to it for the signed-in dev (`jev:seen:<email>`),
 * so the home page shows the banner again only for newer failures. Devs only
 * (`DEV_EMAILS`); anyone else gets 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { isDev } from '@/lib/dev-emails'
import { markJevSeen } from '@/lib/jev'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    logAuthFailure('/api/admin/jev-failures')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isDev(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const raw = (await req.json().catch(() => null))?.at
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    return NextResponse.json({ error: 'at must be an ISO date' }, { status: 400 })
  }
  // Canonical UTC form: the log compares `at` as strings, so an offset form
  // like "…+02:00" must not be stored. A future `at` would mute the banner
  // until then.
  const at = new Date(raw).toISOString()
  const now = new Date().toISOString()
  await markJevSeen(user.email!.toLowerCase(), at > now ? now : at)
  return new NextResponse(null, { status: 204 })
}
