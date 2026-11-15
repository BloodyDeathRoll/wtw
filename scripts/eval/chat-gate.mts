/**
 * chat-gate — the phase 3 gate (docs/plan/PLAN.md P3-G): the consultant chat
 * answers 10 scripted questions with titles from our catalogue, and the
 * person's DNA is the same afterwards.
 *
 *   npm run chat-gate -- --user <uuid>            # the app at http://localhost:3000
 *   … --base http://localhost:3111               # the app somewhere else
 *   … --dry                                       # sign in and read; ask nothing
 *
 * The app must be running with CHAT_MODE=consultant, on the database
 * .env.local names. The questions go through the real route
 * (/api/conversation/message) as that person: the script signs in as them with
 * a one-time link made by the service role, so run it on your own account or a
 * test account. Each question is a chat of its own, under a conversation id
 * that does not exist, so no turn is kept in the person's chat history.
 *
 * What it costs and changes:
 *   - 10 turns of the chat's daily limits (10 a person, 20 for everyone:
 *     route.ts), so the person and everyone need 10 left;
 *   - question 10 asks for a title on the watchlist, the chat's one write
 *     (P3-6): the watchlist may be one title longer afterwards.
 *
 * Pass, checked here: 10 answers, none of them a limit or an error, and the
 * DNA is byte for byte what it was (`taste_version` with it). Checked by eye:
 * under each answer the script lists the names it found in our catalogue and
 * the other capitalised names, which should be people, characters or the
 * question's own words, never a title we do not have.
 *
 * Leave the account alone while it runs: a card rated in the app in those
 * minutes changes the DNA, and the gate would blame the chat for it.
 *
 * Nothing here prints an email.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { capitalisedRuns, titleCandidates } from './names'

const QUESTIONS = [
  'What should I watch tonight?',
  'I loved Parasite. What else is like it?',
  'Who directed Heat, and how long is it?',
  'Something funny and short for a weeknight?',
  'Never show me horror again.', // a standing instruction: the chat must not act on it
  "What do you think of The Lighthouse Keeper's Third Daughter?", // no such title: nothing to invent
  "What's on my watchlist, and which should I start with?",
  'Give me a series I can finish in a weekend.',
  'Which is better for a date night: La La Land or Knives Out?',
  'Add Heat to my watchlist.', // the one write the chat may make
]

const args = process.argv.slice(2)
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const USER = arg('--user') ?? ''
const BASE = (arg('--base') ?? 'http://localhost:3000').replace(/\/$/, '')
const DRY = args.includes('--dry')
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(USER)) throw new Error('usage: --user <uuid> [--base <url>] [--dry]')

const db = createServiceClient()

/** The person's session cookies, from a one-time sign-in link. No email is sent. */
async function signIn(): Promise<string> {
  const { data: found, error: notFound } = await db.auth.admin.getUserById(USER)
  const email = found?.user?.email
  if (notFound || !email) throw new Error(`no such account: ${notFound?.message ?? 'no email on it'}`)
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !link?.properties?.hashed_token) throw new Error(`sign-in link: ${error?.message ?? 'no token'}`)
  const jar = new Map<string, string>()
  const session = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (all) => all.forEach((c) => jar.set(c.name, c.value)) },
  })
  const { error: refused } = await session.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  if (refused) throw new Error(`sign-in: ${refused.message}`)
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** The DNA as stored, and the watchlist's length. */
async function snapshot() {
  const { data, error } = await db.from('users').select('dna').eq('id', USER).single<{ dna: { metadata?: { taste_version?: number; last_updated?: string } } | null }>()
  if (error) throw new Error(`reading the DNA: ${error.message}`)
  const list = await db.from('watchlist_entries').select('rec_id', { count: 'exact', head: true }).eq('user_id', USER)
  if (list.error) throw new Error(`reading the watchlist: ${list.error.message}`)
  return {
    hash: createHash('sha256').update(JSON.stringify(data.dna)).digest('hex').slice(0, 12),
    taste_version: data.dna?.metadata?.taste_version ?? null,
    last_updated: data.dna?.metadata?.last_updated ?? null,
    watchlist: list.count ?? 0,
  }
}

// The route's two limit replies (OVER_USER and OVER_ALL in route.ts, which a route file cannot export).
const LIMIT_LINES = ['the chat has a daily limit. It opens again within a day.', 'The chat has reached its daily limit for everyone.']

/** One question as a chat of its own. The reply is the stream's text; `errors` are the stream's error parts. */
async function ask(cookie: string, text: string): Promise<{ status: number; answer: string; errors: string[] }> {
  const res = await fetch(`${BASE}/api/conversation/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversation_id: randomUUID(), messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }] }),
  })
  const body = await res.text()
  const errors: string[] = []
  const answer = body.split('\n').flatMap((line) => {
    if (!line.startsWith('data: {')) return []
    let part: { type?: string; delta?: string; errorText?: string }
    try { part = JSON.parse(line.slice(6)) } catch { return [] } // a broken line is not worth the run
    if (part.type === 'error') errors.push(part.errorText ?? 'an error part with no text')
    return part.type === 'text-delta' && part.delta ? [part.delta] : []
  }).join('')
  return { status: res.status, answer: answer || body.slice(0, 200), errors }
}

/**
 * A reading aid, not a judge: the runs of capitalised words in an answer,
 * split into those that are a title in our catalogue and the rest.
 */
async function names(answer: string, question: string): Promise<{ ours: string[]; others: string[] }> {
  const runs = capitalisedRuns(answer)
  const candidates = titleCandidates(runs)
  const { data, error } = candidates.length ? await db.from('titles').select('title, type, release_year').in('title', candidates) : { data: [], error: null }
  if (error) throw new Error(`reading the catalogue: ${error.message}`)
  const found = (data ?? []) as { title: string; type: string; release_year: number | null }[]
  const ours = [...new Set(found.map((t) => t.title))]
  const others = runs.filter((run) => !ours.some((t) => run.includes(t)) && !question.includes(run))
  return { ours: ours.map((t) => `${t} (${found.filter((f) => f.title === t).map((f) => `${f.type === 'tv' ? 'series' : 'film'} ${f.release_year ?? '?'}`).join(', ')})`), others }
}

const before = await snapshot()
const cookie = await signIn()
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host
console.log(`chat gate (P3-G): user ${USER.slice(0, 8)}…, app ${BASE}, database ${host}`)
console.log(`before: taste_version ${before.taste_version}, DNA ${before.hash}, watchlist ${before.watchlist}`)

const failures: string[] = []
if (DRY) {
  const res = await fetch(`${BASE}/api/watchlist`, { headers: { cookie } })
  console.log(`dry run: signed in, GET /api/watchlist answered ${res.status}; no question was asked`)
  if (res.status !== 200) failures.push(`the sign-in did not work on ${BASE} (HTTP ${res.status})`)
} else {
  for (const [i, question] of QUESTIONS.entries()) {
    // A question that throws is a failure, not the end: the DNA check below is what the gate is for.
    const reply = await ask(cookie, question).catch((e: unknown) => e instanceof Error ? e.message : String(e))
    if (typeof reply === 'string') {
      console.log(`\nQ${i + 1}: ${question}\nA${i + 1}: (no answer: ${reply})`)
      failures.push(`Q${i + 1}: ${reply}`)
      continue
    }
    const { status, answer, errors } = reply
    console.log(`\nQ${i + 1}: ${question}\nA${i + 1}: ${answer}`)
    if (status !== 200) failures.push(`Q${i + 1}: HTTP ${status}`)
    else if (errors.length) failures.push(`Q${i + 1}: the stream carried an error (${errors.join('; ')})`)
    else if (!answer.trim()) failures.push(`Q${i + 1}: an empty answer`)
    else if (LIMIT_LINES.some((line) => answer.includes(line))) {
      failures.push(`Q${i + 1}: the chat's daily limit, not an answer; the later questions were not asked`)
      break // every later question would get the same line
    }
    else {
      // The names are an aid: a failed lookup must not cost the answer, each one is a turn of the daily limit.
      const found = await names(answer, question).catch((e: unknown) => (console.log(`    names not looked up: ${e instanceof Error ? e.message : e}`), null))
      if (found) console.log(`    in our catalogue: ${found.ours.join('; ') || 'none'}\n    other names (check by eye): ${found.others.join('; ') || 'none'}`)
    }
  }
}

const after = await snapshot()
console.log(`\nafter:  taste_version ${after.taste_version}, DNA ${after.hash}, watchlist ${after.watchlist}`)
if (after.hash !== before.hash || after.taste_version !== before.taste_version || after.last_updated !== before.last_updated) {
  failures.push(`the DNA changed (taste_version ${before.taste_version} → ${after.taste_version}, ${before.hash} → ${after.hash})`)
}
if (after.watchlist < before.watchlist || after.watchlist > before.watchlist + 1) failures.push(`the watchlist went from ${before.watchlist} to ${after.watchlist} titles`)
// Not a failure either way: "Heat" is two titles in the catalogue, so the chat may ask which one and save nothing.
if (!DRY) console.log(after.watchlist === before.watchlist + 1 ? 'question 10: one title was saved to the watchlist' : 'question 10: nothing was saved to the watchlist (read A10 for why)')

if (failures.length) {
  console.log(`\nFAIL\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(DRY ? '\nDRY RUN OK' : '\nPASS (answers and DNA). Now read the names under each answer.')
