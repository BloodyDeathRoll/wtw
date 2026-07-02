import { vi } from 'vitest'

// In-memory stand-in for the Upstash Redis client (`getRedis()` in
// src/lib/redis.ts). Implements the subset the app uses: get/set/del, with
// Upstash's auto-JSON semantics (values are stored as-is, returned as-is).
//
// Usage in a test:
//   const redis = createFakeRedis()
//   vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))
export function createFakeRedis(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))

  return {
    store, // exposed so tests can assert/seed directly
    get: vi.fn(async (key: string): Promise<unknown> => {
      return store.has(key) ? store.get(key) : null
    }),
    set: vi.fn(async (key: string, value: unknown, _opts?: { ex?: number }) => {
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0
      for (const k of keys) if (store.delete(k)) n++
      return n
    }),
    // Convenience for assertions
    _size: () => store.size,
  }
}

export type FakeRedis = ReturnType<typeof createFakeRedis>
