// Shared test doubles for the external services the app depends on.
// Import via a relative path, e.g. `from '../mocks'`, in any test.
export { createFakeRedis, type FakeRedis } from './redis'
export { createFakeSupabase, type FakeSupabase } from './supabase'
export { makeAiMock, fakeModel } from './ai'
