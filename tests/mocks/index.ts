// Shared test doubles for the external services the app depends on.
// Import from '@tests/mocks' (or a relative path) in any test.
export { createFakeRedis, type FakeRedis } from './redis'
export { createFakeSupabase, type FakeSupabase } from './supabase'
export { makeAiMock, fakeModel } from './ai'
