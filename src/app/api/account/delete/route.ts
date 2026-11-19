/**
 * POST /api/account/delete { confirm: 'delete-account' } — Delete my account (v3 Y3, YOU.md DEC-3).
 * Erases the login and, by cascade, everything WTW holds about the person (src/lib/delete-account.ts). The sheet
 * on the Account page asks first; the client then signs out and opens the login page.
 *   200 { ok: true } · 400 not confirmed · 401 signed out · 404 tab bar off · 500 failed (nothing to undo: try again)
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { navTabsEnabled } from '@/lib/flags'
import { deleteAccount } from '@/lib/delete-account'

export async function POST(req: NextRequest) {
  if (!navTabsEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/account/delete')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let confirm: unknown
  try {
    ({ confirm } = await req.json())
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (confirm !== 'delete-account') return NextResponse.json({ error: 'not_confirmed' }, { status: 400 })

  try {
    const r = await deleteAccount(user.id)
    console.log(`[account/delete] account deleted (${r.redisKeys} redis keys)`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[account/delete] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
}
