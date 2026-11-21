import type { UIMessage } from 'ai'

/** The chat's first line when the Watchlist's end card opens it (WATCHLIST.md DEC-9; copy a placeholder, Eran approves at the PR). */
export const WATCHLIST_OPENER = "Want to talk about what's on your list, or something new?"

/**
 * The chat's history with `text` said by the assistant last, so the model reads a reply as an answer to it. Already
 * the last line (the card tapped twice): unchanged.
 */
export function withOpener(prev: UIMessage[], text: string, id: string): UIMessage[] {
  const last = prev.at(-1)
  const lastText = last?.role === 'assistant' ? last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('') : null
  return lastText === text ? prev : [...prev, { id, role: 'assistant', parts: [{ type: 'text', text }] }]
}
