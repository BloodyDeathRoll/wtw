# Tests

Vitest + React Testing Library. See `vitest.config.ts` at the repo root.

## Running

```bash
npm test            # run once (CI mode)
npm run test:watch  # re-run on change while developing
npm run test:coverage
```

## Layout & conventions

```
tests/
├── setup.ts              # global setup: jest-dom matchers, auto-cleanup
├── mocks/                # shared test doubles for external services
│   ├── redis.ts          #   createFakeRedis()   — in-memory Upstash stand-in
│   ├── supabase.ts       #   createFakeSupabase() — chainable query builder
│   ├── ai.ts             #   makeAiMock()         — generateText/generateObject
│   └── index.ts          #   import { … } from '../mocks'
├── unit/                 # pure logic — node-fast, no DOM (scoring, DNA, lib)
└── component/            # React components (jsdom + RTL)
```

- Test files are `*.test.ts` / `*.test.tsx`, placed under `tests/` mirroring the area under test.
- Import app code with the `@/…` alias, exactly like the app does (`import { safeNextPath } from '@/lib/safe-redirect'`).
- **Ownership still applies:** a test for `src/modules/<x>/` is written by that module's owner. The shared harness and `tests/mocks/` are shared — coordinate changes.

## Wiring the mocks into a test

The app reads external services through singletons (`getRedis()`, `createServiceClient()`, the `ai` package). Swap them with `vi.mock`:

```ts
import { vi } from 'vitest'
import { createFakeRedis, createFakeSupabase } from '../mocks'

const redis = createFakeRedis({ 'dna:u1': { metadata: { taste_version: 3 } } })
const db = createFakeSupabase({ users: { data: { dna: null }, error: null } })

vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db }))

// force an LLM failure to prove graceful degradation:
vi.mock('ai', () => require('../mocks').makeAiMock({ throws: new Error('429') }))
```

## Where to start

The review in `docs/code-review-2026-07-01.md` lists a concrete test for every
finding. The high-severity ones (H2 lost updates, H3 decay-runs-once, H4 rating
halving, H5 LLM failure) are the first regression tests worth adding.
