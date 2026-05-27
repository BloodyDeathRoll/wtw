// Slim user shape passed from server components down into the session module.
// Decoupled from @supabase/supabase-js so the module compiles without that
// dep and so we can pass test fixtures freely.

export interface AppUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export type ConversationStage = "onboard" | "welcome" | "conversation";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Hydration shape passed from server → WTWApp. Mirrors the `conversations`
// + `messages` tables but flattened so the client can init useChat without
// any further fetches.
export interface Conversation {
  id: string;
  session_number: number;
  stage: ConversationStage;
  favorites: string;
  messages: ConversationMessage[];
}

// Greeting data computed server-side per page load. Greeting is non-null
// only when the user has crossed the maturity threshold for signals.
export interface Welcome {
  greeting: string | null;
}
