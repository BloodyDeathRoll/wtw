// Conversation API.
// Auth-gated (Supabase session required), streams Groq/Llama 3.3 70B via the
// Vercel AI SDK. Response shape matches `useChat`'s data-stream protocol so
// the client wiring can drop in without server changes.
//
// The model is briefed on the user's fingerprint (2026-08-29). Until then it
// got a hardcoded prompt and the message history and nothing else — no rules,
// no strands, no signals — which is why it would agree to "no anime" and then
// have no way to honour it, and why every title it named inline was a guess.
//
// The chat changes nothing in the fingerprint (DEC-5, docs/plan/PLAN.md P1-C1):
// no rules, preferences, moods or titles are taken from it, here or at session
// end. With CHAT_MODE=off the route is closed.

import { groq } from "@ai-sdk/groq";
import { MODELS, GROQ_TEXT_OPTIONS } from "@/lib/ai-models";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { boundedTail } from "@/lib/bounded-tail";
import { loadDNA } from "@/modules/dna/lib/load-save";
import { dnaPromptContext } from "@/modules/dna/lib/prompt-context";
import { chatMode } from "@/lib/flags";
import {
  saveMessage,
  updateConversationState,
} from "@/lib/conversations";
import type { ConversationStage } from "@/modules/session/types";

export const runtime = "nodejs";

// What one request may cost us (audit 2026-09-11, RULES A5/G10). The client
// sends the whole history every turn, so bound it: a calibration chat is a few
// dozen short turns, and a reply is "one or two short sentences". The bound is
// enforced by TRIMMING (boundedTail), not by refusing the request — see the
// note at the call site.
const MAX_MESSAGES = 60;
const MAX_HISTORY_CHARS = 24_000;
// Generous because MODELS.text is a REASONING model: the reasoning trace is
// billed against this same completion budget, before a single token of the
// reply is emitted. Measured 2026-09-20 against a real 60-message history and
// the full system prompt — at 300 the call returned `finishReason: 'length'`
// with the answer cut off mid-sentence, and on a longer trace nothing at all,
// which is what surfaced in the app as an empty assistant bubble. The same
// prompt finishes at 552 completion tokens, so 1200 leaves real headroom
// for a longer trace rather than sitting just above the observed figure.
//
// This is NOT a longer reply: the prompt still asks for one or two short
// sentences, and the reply itself is a fraction of this. It is headroom for
// the part of the budget the user never sees. @ai-sdk/groq forwards only
// `reasoningFormat`, not `reasoning_effort`, so the trace cannot be shortened
// from here — only paid for.
const MAX_REPLY_TOKENS = 1200;
const RATE_LIMIT = { scope: "conversation", perUser: 60, perIp: 120, windowSec: 10 * 60 };

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

Nothing said in this chat is saved or remembered: not rules ("never show me anime", "less romance"), not titles, not moods. If the user gives you a standing instruction, say in a few words that rules are set on the Taste DNA page, and move on. Never say anything has been saved, recorded, stored, applied or kept in mind.`;

function messageText(m: UIMessage): string {
  // A tab still running the pre-v7 bundle during a deploy sends `content`.
  const legacy = (m as { content?: unknown }).content;
  if (typeof legacy === "string") return legacy;
  return m.parts?.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
}

/** The parts-only shape convertToModelMessages reads, whatever the client sent. */
function toPartsMessage(m: UIMessage): UIMessage {
  return { id: m.id, role: m.role, parts: [{ type: "text", text: messageText(m) }] };
}

export async function POST(req: Request) {
  if (chatMode() === "off") return NextResponse.json({ error: "chat is off" }, { status: 404 });
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    logAuthFailure("/api/conversation/message");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT);
  if (limited) return limited;

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
  // TRIM the history rather than refusing it (2026-09-20). This used to 413,
  // which bounded our cost by locking the user out of their own conversation:
  // an account with 107 messages — ordinary, since conversations never rotated
  // until migration 0022 — got "Couldn't reach the model" on every turn, with
  // nothing to do about it. The cost guard is satisfied by sending less, not
  // by answering nothing. The most recent turns are the ones that matter for
  // the next question.
  const history = boundedTail(messages, messageText, MAX_MESSAGES, MAX_HISTORY_CHARS);
  if (history.length < messages.length) {
    console.log(`[conversation] history trimmed: ${messages.length} → ${history.length} messages`);
  }

  // Persist the user's latest message (the last item — useChat always
  // sends history + the new one). RLS ensures the conversation belongs
  // to this user; if it doesn't, the insert silently no-ops and we
  // continue anyway (the model still gets the context from `messages`).
  const last = messages[messages.length - 1];
  const userTurn = last.role === "user" ? messageText(last) : "";
  if (userTurn) {
    try {
      await saveMessage(supabase, conversationId, "user", userTurn);
    } catch (e) {
      console.error("[conversation] failed to save user message", e);
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
    providerOptions: GROQ_TEXT_OPTIONS,
    instructions: SYSTEM_PROMPT + dnaContext,
    messages: await convertToModelMessages(history.map(toPartsMessage)),
    maxOutputTokens: MAX_REPLY_TOKENS,
    onEnd: async ({ text }) => {
      if (!text) return;
      try {
        await saveMessage(supabase, conversationId, "assistant", text);
      } catch (e) {
        console.error("[conversation] failed to save assistant message", e);
      }
    },
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
