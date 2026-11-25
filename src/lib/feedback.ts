/**
 * "Send us feedback" (v3 Y2, docs/plan/v3/YOU.md DEC-5): notes from the app to the team's inbox.
 *
 * A note is saved (`feedback`, migration 0037), then emailed through Resend's
 * send endpoint with a plain fetch (no new package). Resend's shared sender
 * delivers only to the address its account was opened with, which is the one
 * inbox we send to, so no domain of our own is needed. Reply-To is the sender,
 * so Reply in Gmail answers them. A failed email keeps the note: the nightly
 * retry (/api/cron/feedback) tries again, up to MAX_ATTEMPTS.
 *
 * Needs RESEND_API_KEY and FEEDBACK_TO. Without them the feature is off: the
 * row on You is hidden and the send route answers "unavailable".
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'

export const FEEDBACK_MAX_CHARS = 2000
export const FEEDBACK_PER_HOUR = 5
export const MAX_ATTEMPTS = 5
const FROM = 'WTW feedback <onboarding@resend.dev>'
const RESEND_URL = 'https://api.resend.com/emails'

export function feedbackConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() && !!process.env.FEEDBACK_TO?.trim()
}

export interface FeedbackSender {
  id: string
  email: string | null
  name: string | null
}

export interface FeedbackNote {
  body: string
  created_at: string
  user_agent: string | null
}

/** The email Resend sends: the note in full, then who sent it, when (Israel time) and from what. */
export function feedbackEmail(note: FeedbackNote, sender: FeedbackSender, to: string) {
  const when = new Date(note.created_at).toLocaleString('en-GB', {
    timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short',
  })
  const text = [
    note.body,
    '',
    '—',
    `From: ${sender.name ?? '(no name)'}${sender.email ? ` <${sender.email}>` : ''}`,
    `User id: ${sender.id}`,
    `Sent: ${when} (Israel time)`,
    `Phone and browser: ${note.user_agent ?? '(unknown)'}`,
  ].join('\n')
  return {
    from: FROM,
    to: [to],
    ...(sender.email ? { reply_to: sender.email } : {}),
    subject: `WTW feedback from ${sender.name ?? sender.email ?? 'a WTW user'}`,
    text,
  }
}

/** Emails one note. True when Resend accepted it. Never throws. */
export async function emailFeedback(
  note: FeedbackNote,
  sender: FeedbackSender,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim()
  const to = process.env.FEEDBACK_TO?.trim()
  if (!key || !to) return false
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(feedbackEmail(note, sender, to)),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) console.error(`[feedback] Resend answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    return res.ok
  } catch (err) {
    console.error('[feedback] email failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/** After a send attempt: stamp it sent, or count the attempt for the nightly retry. Best-effort. */
export async function markAttempt(id: number, sent: boolean, attempts: number): Promise<void> {
  const db = createServiceClient()
  const patch = sent ? { emailed_at: new Date().toISOString(), attempts: attempts + 1 } : { attempts: attempts + 1 }
  const { error } = await db.from('feedback').update(patch).eq('id', id)
  if (error) console.error('[feedback] could not record the attempt:', error.message)
}

/** The nightly retry: unsent notes with attempts left, oldest first. */
export async function retryUnsent(limit = 50): Promise<{ tried: number; sent: number }> {
  if (!feedbackConfigured()) return { tried: 0, sent: 0 }
  const db = createServiceClient()
  const { data, error } = await db
    .from('feedback')
    .select('id, user_id, body, created_at, user_agent, attempts')
    .is('emailed_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(limit)
  if (error) throw new Error(error.message)
  let sent = 0
  for (const row of data ?? []) {
    const { data: u } = await db.auth.admin.getUserById(row.user_id)
    const meta = u?.user?.user_metadata as { full_name?: string; name?: string } | undefined
    const sender = { id: row.user_id, email: u?.user?.email ?? null, name: meta?.full_name ?? meta?.name ?? null }
    const ok = await emailFeedback(row, sender)
    await markAttempt(row.id, ok, row.attempts)
    if (ok) sent++
  }
  return { tried: data?.length ?? 0, sent }
}
