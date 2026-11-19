/**
 * The chat's two daily-limit replies (src/lib/chat-budget.ts). Plain strings, no server imports: the app reads them
 * too, to stop offering the chat once it has said one (WATCHLIST.md DEC-9). They say "daily" and "within a day": they
 * go with the one-day window in chat-budget.ts.
 */
export const CHAT_OVER_USER =
  "That's all the questions I can take from you for now: the chat has a daily limit. It opens again within a day. Your recommendations are on the home screen as always."
export const CHAT_OVER_ALL =
  'The chat has reached its daily limit for everyone. It opens again within a day. Your recommendations are on the home screen as always.'
export const CHAT_LIMIT_LINES: readonly string[] = [CHAT_OVER_USER, CHAT_OVER_ALL]
