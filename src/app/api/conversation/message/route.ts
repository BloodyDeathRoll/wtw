// Conversation API.
// Auth-gated (Supabase session required), streams Groq/Llama 3.3 70B via the
// Vercel AI SDK. Response shape matches `useChat`'s data-stream protocol so
// the client wiring can drop in without server changes.
//
// The model is briefed on the user's fingerprint (2026-08-29). Until then it
// got a hardcoded prompt and the message history and nothing else — no rules,
// no strands, no signals — which is why it would agree to "no anime" and then
// have no way to honour it, and why every title it named inline was a guess.
// Signal extraction still happens at session end, not here.

import { groq } from "@ai-sdk/groq";
import { MODELS } from "@/lib/ai-models";
import { convertToCoreMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadDNA } from "@/modules/dna/lib/load-save";
import { dnaPromptContext } from "@/modules/dna/lib/prompt-context";
import {
  saveMessage,
  updateConversationState,
} from "@/lib/conversations";
import type { ConversationStage } from "@/modules/session/types";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are WTW (What To Watch). Your job is to build a vivid, layered picture of the user's film and TV taste through light, casual conversation — not an interview.

Each turn, ask ONE focused question that surfaces a NEW dimension of their taste. Rotate territory across turns: directors or actors whose work they trust, a recent watch they loved or hated and why, tolerance for moral ambiguity, fast cuts vs. long takes, what they'll never watch, who they usually watch with, how much narrative work they want to do, mood right now.

Style rules:
- One or two short sentences per turn. Warm and curious, not interrogating.
- Do not summarize, restate, or react to the user's previous answer. Just ask the next question.
- Do not probe the same dimension two turns in a row.
- Plain prose only — no lists, JSON, or markdown tables.

If the user explicitly asks for a recommendation:
- If you barely know them, say so honestly in one line and either offer a tentative pick with a hedge ("based on the little I have so far, you might try…") or ask one more taste-revealing question first.
- If you have several signals, name one or two titles inline in prose with a one-line "why this".
- Anything you name in conversation is a conversational suggestion; the ranked batch comes from the recommendation engine.

If the user gives you a standing instruction ("never show me anime", "less
romance", "nothing with that actor"), acknowledge it in a few words and move
on. It is recorded when the session ends and applied to every future batch —
so do not promise to "keep it in mind", and never claim to have already
changed anything.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        messages?: UIMessage[];
        conversation_id?: string;
        stage?: ConversationStage;
        favorites?: string;
      }
    | null;
  const messages = body?.messages;
  const conversationId = body?.conversation_id;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages must be a non-empty array" },
      { status: 400 },
    );
  }
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversation_id required" },
      { status: 400 },
    );
  }

  // Persist the user's latest message (the last item — useChat always
  // sends history + the new one). RLS ensures the conversation belongs
  // to this user; if it doesn't, the insert silently no-ops and we
  // continue anyway (the model still gets the context from `messages`).
  const last = messages[messages.length - 1];
  if (last.role === "user") {
    const content =
      typeof last.content === "string"
        ? last.content
        : last.parts
            ?.map((p) => (p.type === "text" ? p.text : ""))
            .join("") ?? "";
    if (content) {
      try {
        await saveMessage(supabase, conversationId, "user", content);
      } catch (e) {
        console.error("[conversation] failed to save user message", e);
      }
    }
  }

  // Stage/favorites land on first onboard submit (and stay sticky). The
  // client sends them in the body so we don't need a separate PATCH.
  if (body?.stage || body?.favorites !== undefined) {
    try {
      await updateConversationState(supabase, conversationId, {
        stage: body.stage,
        favorites: body.favorites,
      });
    } catch (e) {
      console.error("[conversation] failed to update state", e);
    }
  }

  // The fingerprint briefing. Best-effort: a DNA read failure degrades the
  // turn to the old context-free behaviour rather than failing the chat.
  // loadDNA is cached (60s), so this is usually not a round trip.
  let dnaContext = "";
  try {
    dnaContext = dnaPromptContext(await loadDNA(user.id));
  } catch (e) {
    console.error("[conversation] DNA context unavailable", e);
  }

  const result = streamText({
    model: groq(MODELS.text),
    system: SYSTEM_PROMPT + dnaContext,
    messages: convertToCoreMessages(messages),
    onFinish: async ({ text }) => {
      if (!text) return;
      try {
        await saveMessage(supabase, conversationId, "assistant", text);
      } catch (e) {
        console.error("[conversation] failed to save assistant message", e);
      }
    },
  });

  return result.toDataStreamResponse();
}
