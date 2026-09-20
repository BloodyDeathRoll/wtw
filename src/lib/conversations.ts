// Server-side helpers for the `conversations` + `messages` tables.
// Used by both `/app/page.tsx` (initial hydration) and the streaming chat
// route (writes during a turn). RLS lets these run with the user's anon
// session — no service role needed.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Conversation,
  ConversationMessage,
  ConversationStage,
} from "@/modules/session/types";

interface ConversationRow {
  id: string;
  session_number: number;
  stage: ConversationStage;
  favorites: string;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * Returns the user's OPEN conversation, or starts a fresh one if none is open.
 * Messages come back ordered chronologically.
 *
 * "Open" means `ended_at is null` (migration 0022). Without that filter this
 * returned the most recent conversation unconditionally and nothing ever
 * closed one, so a user had a single conversation forever: `session_number`
 * never left 1, and `/api/session/end` re-analysed the entire history — 105
 * messages on one live account — through the extraction LLM every time.
 */
export async function getOrCreateActiveConversation(
  supabase: SupabaseClient,
  userId: string,
): Promise<Conversation> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, session_number, stage, favorites")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle<ConversationRow>();

  const row = existing ?? (await createConversation(supabase, userId));

  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", row.id)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  return {
    id: row.id,
    session_number: row.session_number,
    stage: row.stage,
    favorites: row.favorites,
    messages: (messages ?? []) as ConversationMessage[],
  };
}

async function createConversation(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConversationRow> {
  // Continue the user's numbering rather than restarting at 1 — the column
  // defaults to 1, which was invisible while nobody ever created a second one.
  const { data: last } = await supabase
    .from("conversations")
    .select("session_number")
    .eq("user_id", userId)
    .order("session_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ session_number: number }>();

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, session_number: (last?.session_number ?? 0) + 1 })
    .select("id, session_number, stage, favorites")
    .single<ConversationRow>();

  if (error || !data) {
    throw new Error(`failed to create conversation: ${error?.message}`);
  }
  return data;
}

export async function saveMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role, content });
  if (error) throw new Error(`failed to save ${role} message: ${error.message}`);
}

export async function updateConversationState(
  supabase: SupabaseClient,
  conversationId: string,
  patch: { stage?: ConversationStage; favorites?: string },
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  // The DB trigger only bumps last_active_at on new messages, so a stage or
  // favorites change before the user's first message would otherwise leave
  // the conversation stuck at its created-at timestamp and never surface as
  // "most recent" in getOrCreateActiveConversation.
  const { error } = await supabase
    .from("conversations")
    .update({ ...patch, last_active_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw new Error(`failed to update conversation: ${error.message}`);
}

/**
 * Close a conversation so the next visit starts a fresh one. Called by
 * /api/session/end once a real transcript has been merged into the
 * fingerprint — NOT on a "Find more", which is the same sitting continuing.
 *
 * Best-effort: failing to rotate leaves the user in the conversation they are
 * already in, which is the old behaviour, not a broken one.
 */
export async function endConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<void> {
  // `session_number` is deliberately NOT written here. It is a per-conversation
  // ordinal, set once at creation from the previous conversation's. The DNA's
  // `total_sessions` is a different counter — it advances on every merge,
  // including a "Find more" that falls through to one — so stamping it here
  // would seed the next conversation off an inflated value and let the two
  // drift apart permanently, with nothing to reconcile them.
  const { error } = await supabase
    .from("conversations")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", conversationId)
    .is("ended_at", null);
  if (error) throw new Error(`failed to end conversation: ${error.message}`);
}
