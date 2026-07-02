import { vi } from 'vitest'

// Minimal chainable stand-in for the Supabase client used across the app
// (`from(...).select(...).eq(...).single()`, `.update(...).eq(...)`,
// `.insert(...)`, `.in(...)`, `.order(...)`, RPC).
//
// Each table is backed by a canned result you provide. The builder is
// intentionally permissive: every chain method returns `this`, and the chain
// is thenable so `await`-ing it (or calling `.single()`) resolves to the
// canned `{ data, error }`. `update`/`insert`/`delete` also record their
// payloads on `writes` so tests can assert what was persisted.
//
// Usage:
//   const db = createFakeSupabase({
//     users: { data: { dna: myDna }, error: null },
//   })
//   vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db }))
type TableResult = { data: unknown; error: unknown }

interface FakeBuilder {
  _table: string
  select: (...args: unknown[]) => FakeBuilder
  eq: (...args: unknown[]) => FakeBuilder
  in: (...args: unknown[]) => FakeBuilder
  order: (...args: unknown[]) => FakeBuilder
  limit: (...args: unknown[]) => FakeBuilder
  single: () => Promise<TableResult>
  maybeSingle: () => Promise<TableResult>
  update: (payload: unknown) => FakeBuilder
  insert: (payload: unknown) => FakeBuilder
  delete: () => FakeBuilder
  // Awaitable → resolves to the canned result.
  then: (resolve: (v: TableResult) => unknown) => unknown
}

export function createFakeSupabase(tables: Record<string, TableResult> = {}) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = []
  const rpcCalls: Array<{ fn: string; args: unknown }> = []
  const rpcResults: Record<string, TableResult> = {}

  function makeBuilder(table: string): FakeBuilder {
    const result: TableResult = tables[table] ?? { data: null, error: null }

    const builder: FakeBuilder = {
      _table: table,
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(async () => result),
      maybeSingle: vi.fn(async () => result),
      update: vi.fn((payload: unknown) => {
        writes.push({ table, op: 'update', payload })
        return builder
      }),
      insert: vi.fn((payload: unknown) => {
        writes.push({ table, op: 'insert', payload })
        return builder
      }),
      delete: vi.fn(() => {
        writes.push({ table, op: 'delete', payload: null })
        return builder
      }),
      then: (resolve: (v: TableResult) => unknown) => resolve(result),
    }
    return builder
  }

  return {
    writes,   // assert what was written
    rpcCalls, // assert RPC invocations
    setRpcResult(fn: string, res: TableResult) {
      rpcResults[fn] = res
    },
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return rpcResults[fn] ?? { data: null, error: null }
    }),
  }
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>
