/**
 * Everything the home and play screens need from the database, in ONE round
 * trip: the `home_bootstrap()` RPC (migration 0027, message order fixed in
 * 0028). The home page used to make 5–6 calls in sequence (open
 * conversation, its messages, feedback count, conversation list, message
 * count, play state) at ~300 ms each from the Frankfurt functions to the
 * Sydney database — docs/speed-plan.md, D.
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
  /** The open conversation, or null when there is none — `openConversation`
   *  creates it. Nothing is inserted here, so a page that redirects (a new
   *  user sent to /play) costs no write. */
  conversation: Conversation | null;
  /** The number the next conversation gets; 0 when `conversation` is set by
   *  the fallback path (it already created one). */
  nextSessionNumber: number;
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

/** PostgREST: the function (PGRST202) or something it reads is not in the
 *  schema — not migrated yet. Taken quietly; anything else is warned. */
const isNotMigrated = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || isMissingTable(error));

export async function loadHomeBootstrap(
  supabase: SupabaseClient,
  userId: string,
): Promise<HomeBootstrap> {
  const { data, error } = await supabase.rpc("home_bootstrap").single<RpcRow>();

  if (error) {
    if (!isNotMigrated(error)) console.warn("[home] home_bootstrap failed, falling back:", error.message);
    return fallback(supabase, userId);
  }

  const conversation: Conversation | null = data.conversation && {
    id: data.conversation.id,
    session_number: data.conversation.session_number,
    stage: data.conversation.stage,
    favorites: data.conversation.favorites,
    messages: data.messages as ConversationMessage[],
  };

  const state = data.play?.state && (data.play.state as Partial<PlayState>).v === 3 ? data.play.state : null;
  const play: SavedPlay = data.play
    ? { mode: "server", state, version: data.play.version }
    : { mode: "server", state: null, version: 0 };

  return {
    conversation,
    nextSessionNumber: data.next_session_number,
    signals: data.feedback_count + data.user_message_count,
    play,
  };
}

/** The open conversation, created with the number the RPC returned when
 *  there is none — one insert, no select first. */
export async function openConversation(
  supabase: SupabaseClient,
  userId: string,
  boot: HomeBootstrap,
): Promise<Conversation> {
  if (boot.conversation) return boot.conversation;
  const row = await createConversationNumbered(supabase, userId, boot.nextSessionNumber);
  return { id: row.id, session_number: row.session_number, stage: row.stage, favorites: row.favorites, messages: [] };
}

async function fallback(supabase: SupabaseClient, userId: string): Promise<HomeBootstrap> {
  const [conversation, signals, play] = await Promise.all([
    getOrCreateActiveConversation(supabase, userId),
    countUserSignals(supabase, userId),
    loadPlay(supabase, userId),
  ]);
  return { conversation, nextSessionNumber: 0, signals, play };
}
