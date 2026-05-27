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
 * Returns the user's most recent conversation, or creates a fresh one
 * (session_number 1) if none exists. Messages come back ordered chronologically.
 */
export async function getOrCreateActiveConversation(
  supabase: SupabaseClient,
  userId: string,
): Promise<Conversation> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, session_number, stage, favorites")
    .eq("user_id", userId)
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
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId })
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
