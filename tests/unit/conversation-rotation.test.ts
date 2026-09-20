import { describe, it, expect } from 'vitest'
import {
  getOrCreateActiveConversation,
  endConversation,
} from '@/lib/conversations'
import type { SupabaseClient } from '@supabase/supabase-js'

// 2026-09-20, row 8: getOrCreateActiveConversation returned the most recent
// conversation unconditionally and nothing ever closed one, so every user had
// exactly one conversation for life — session_number stuck at 1, and
// /api/session/end re-analysed the whole message history (105 messages on one
// live account) through the extraction LLM every single time.

type Row = { id: string; session_number: number; stage: string; favorites: string; ended_at: string | null }

/** Chainable stand-in that records the filters a query actually applied. */
function fakeSupabase(rows: Row[]) {
  const calls: { table: string; filters: Record<string, unknown>; op: string; payload?: unknown }[] = []

  const client = {
    calls,
    rows,
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let op = 'select'
      let payload: unknown
      let order: { col: string; asc: boolean } | null = null

      const b = {
        select: () => b,
        insert: (p: unknown) => { op = 'insert'; payload = p; return b },
        update: (p: unknown) => { op = 'update'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters[c] = v; return b },
        is: (c: string, v: unknown) => { filters[`${c}:is`] = v; return b },
        order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b },
        limit: () => b,
        returns: () => b,
        maybeSingle: async () => {
          calls.push({ table, filters, op })
          if (table === 'messages') return { data: [], error: null }
          let found = [...client.rows]
          if ('ended_at:is' in filters) found = found.filter(r => r.ended_at === null)
          if (order?.col === 'session_number') {
            found = [...found].sort((a, z) => z.session_number - a.session_number)
          }
          return { data: found[0] ?? null, error: null }
        },
        single: async () => {
          calls.push({ table, filters, op, payload })
          const p = payload as { session_number: number }
          const row: Row = { id: `c${client.rows.length + 1}`, session_number: p.session_number, stage: 'onboard', favorites: '', ended_at: null }
          client.rows.push(row)
          return { data: row, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => {
          calls.push({ table, filters, op, payload })
          if (op === 'update') {
            for (const r of client.rows) {
              if (r.id === filters['id'] && r.ended_at === null) Object.assign(r, payload)
            }
          }
          return resolve({ data: [], error: null })
        },
      }
      return b
    },
  }
  return client as unknown as SupabaseClient & typeof client
}

const open = (n: number): Row => ({ id: `c${n}`, session_number: n, stage: 'conversation', favorites: '', ended_at: null })
const closed = (n: number): Row => ({ ...open(n), ended_at: '2026-09-20T00:00:00Z' })

describe('conversation rotation', () => {
  it('only ever hands back an OPEN conversation', async () => {
    const db = fakeSupabase([open(1)])
    await getOrCreateActiveConversation(db, 'u1')

    // The filter is the whole fix — without it a finished conversation is
    // handed back forever.
    const lookup = db.calls.find(c => c.table === 'conversations' && c.op === 'select')
    expect(lookup?.filters['ended_at:is']).toBeNull()
  })

  it('starts a fresh conversation once the last one is closed', async () => {
    const db = fakeSupabase([closed(1)])
    const convo = await getOrCreateActiveConversation(db, 'u1')

    expect(convo.id).not.toBe('c1')
    expect(convo.session_number).toBe(2)
  })

  it('continues the numbering instead of restarting at 1', async () => {
    const db = fakeSupabase([closed(1), closed(2), closed(3)])
    expect((await getOrCreateActiveConversation(db, 'u1')).session_number).toBe(4)
  })

  it('returns the open conversation rather than making another', async () => {
    const db = fakeSupabase([closed(1), open(2)])
    const convo = await getOrCreateActiveConversation(db, 'u1')

    expect(convo.id).toBe('c2')
    expect(db.calls.some(c => c.op === 'insert')).toBe(false)
  })

  it('closes a conversation without touching its number', async () => {
    // session_number is a per-conversation ordinal. The DNA's total_sessions
    // is a different counter that advances on merges this never sees, so
    // writing it here would seed the next conversation off an inflated value.
    const db = fakeSupabase([open(1)])
    await endConversation(db, 'c1')

    expect(db.rows[0].ended_at).toBeTruthy()
    expect(db.rows[0].session_number).toBe(1)
  })

  it('will not reopen an already-closed conversation', async () => {
    const db = fakeSupabase([closed(3)])
    const before = db.rows[0].ended_at
    await endConversation(db, 'c3')

    expect(db.rows[0].ended_at).toBe(before)
    expect(db.rows[0].session_number).toBe(3)
  })
})
