/**
 * v2 plan switches (docs/plan/PLAN.md §8), read from env. The default is
 * today's behaviour; set them in Vercel and in .env.local. Switching one on
 * is a gate. A flag the client reads is listed under `env` in next.config.ts
 * (inlined at build, so a change takes a redeploy).
 */

/** DEC-5: `off` hides the chat (text and voice) until it returns as a consultant in phase 3. */
export type ChatMode = 'legacy' | 'off' | 'consultant'

export function chatMode(): ChatMode {
  const v = process.env.CHAT_MODE
  return v === 'off' || v === 'consultant' ? v : 'legacy'
}
