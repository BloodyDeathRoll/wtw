/**
 * Everything the home and play screens need from the database, in ONE round
 * trip: the `home_bootstrap()` RPC (migration 0027). The home page used to
 * make 5–6 calls in sequence (open conversation, its messages, feedback
 * count, conversation list, message count, play state) at ~300 ms each from
 * the Frankfurt functions to the Sydney database — docs/speed-plan.md, D.
 *
 * Falls back to the per-table helpers when the function is not there yet
 * (migration not applied), so a deploy ahead of the migration still works.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ConversationMessage } from "@/modules/session/types";
import {
  createConversationNumbered,
  getOrCreateActiveConversation,
  type ConversationRow,
  type MessageRow,
} from "@/lib/conversations";
import { countUserSignals } from "@/lib/welcome";
import { isMissingTable, loadPlay, type SavedPlay } from "@/app/play/lib/server";
import type { PlayState } from "@/app/play/lib/brain";

export interface HomeBootstrap {
  conversation: Conversation;
  /** Chat turns + feedback rows — the maturity count (`countUserSignals`). */
  signals: number;
  play: SavedPlay;
}

interface RpcRow {
  conversation: ConversationRow | null;
  messages: MessageRow[];
  next_session_number: number;
  feedback_count: number;
  user_message_count: number;
  play: { state: PlayState; version: number } | null;
}

/** PostgREST: the function is not in the schema (not migrated yet). */
const isMissingFunction = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || isMissingTable(error));

export async function loadHomeBootstrap(
  supabase: SupabaseClient,
  userId: string,
): Promise<HomeBootstrap> {
  const { data, error } = await supabase.rpc("home_bootstrap").single<RpcRow>();

  if (error) {
    if (!isMissingFunction(error)) console.warn("[home] home_bootstrap failed, falling back:", error.message);
    return fallback(supabase, userId);
  }

  const row = data.conversation ?? (await createConversationNumbered(supabase, userId, data.next_session_number));
  const conversation: Conversation = {
    id: row.id,
    session_number: row.session_number,
    stage: row.stage,
    favorites: row.favorites,
    messages: (data.conversation ? data.messages : []) as ConversationMessage[],
  };

  const state = data.play?.state && (data.play.state as Partial<PlayState>).v === 3 ? data.play.state : null;
  const play: SavedPlay = data.play
    ? { mode: "server", state, version: data.play.version }
    : { mode: "server", state: null, version: 0 };

  return { conversation, signals: data.feedback_count + data.user_message_count, play };
}

async function fallback(supabase: SupabaseClient, userId: string): Promise<HomeBootstrap> {
  const [conversation, signals, play] = await Promise.all([
    getOrCreateActiveConversation(supabase, userId),
    countUserSignals(supabase, userId),
    loadPlay(supabase, userId),
  ]);
  return { conversation, signals, play };
}
