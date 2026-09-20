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
// Standing instructions stated plainly ("no horror") are now written in the
// turn itself by pattern (2026-09-20), so the rule exists before the reply is
// generated and the reply can only claim what is on disk. Title signals, people
// and unusual phrasings are still extracted at session end.

import { groq } from "@ai-sdk/groq";
import { MODELS } from "@/lib/ai-models";
import { convertToCoreMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { loadDNA, saveDNA, bumpVersion } from "@/modules/dna/lib/load-save";
import { dnaPromptContext } from "@/modules/dna/lib/prompt-context";
import { applyDirectives, directivesChanged } from "@/modules/dna/lib/apply-directives";
import { extractDirectivesFromText } from "@/modules/session/directive-patterns";
import {
  saveMessage,
  updateConversationState,
} from "@/lib/conversations";
import type { ConversationStage } from "@/modules/session/types";

export const runtime = "nodejs";

// What one request may cost us (audit 2026-09-11, RULES A5/G10). The client
// sends the whole history every turn, so bound it: a calibration chat is a few
// dozen short turns, and a reply is "one or two short sentences".
const MAX_MESSAGES = 60;
const MAX_HISTORY_CHARS = 24_000;
const MAX_REPLY_TOKENS = 300;
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

If the user gives you a standing instruction ("never show me anime", "less
romance", "nothing with that actor"), acknowledge in a few words that you heard
it and move on. Never say an instruction has been saved, recorded, stored or
applied unless a RECORDED line below names it — if there is no such line, you
do not know whether it was captured, and saying "got it, no more anime" when
nothing was written is how a user ended up asking for the same thing across
five sessions. Never promise to "keep it in mind" either.`;

function messageText(m: UIMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.parts?.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
}

/**
 * Write the standing instructions this turn stated plainly, and return the
 * names actually written. Bumps taste_version because the rec cache is keyed
 * by it — a new rule has to bust the batch it was not applied to.
 *
 * Best-effort: a write failure returns nothing, which is exactly right. The
 * assistant is only ever told about rules that are on disk, so a failure here
 * can make it under-claim, never over-claim.
 */
async function recordDirectives(userId: string, text: string): Promise<string[]> {
  const directives = extractDirectivesFromText(text);
  if (directives.length === 0) return [];

  try {
    const dna = await loadDNA(userId);
    const merged = applyDirectives(dna.contextual_logic, directives);
    // `updated` counts too: saying "less romance" over an existing weaker
    // preference tightens it in place without adding anything, and saving only
    // on an added count discarded exactly the change the user just asked for.
    if (!directivesChanged(merged)) {
      // Already known, unchanged — still true, so the assistant may say so.
      return directives.map((d) => d.name);
    }
    bumpVersion(dna);
    await saveDNA(userId, dna);
    console.log(
      `[conversation] recorded ${merged.exclusions_added} rule(s), ` +
        `${merged.soft_preferences_added} preference(s) and ` +
        `${merged.updated} update(s) from this turn`,
    );
    return directives.map((d) => d.name);
  } catch (e) {
    console.error("[conversation] directive write failed", e);
    return [];
  }
}

function recordedContext(names: string[]): string {
  if (names.length === 0) return "";
  return `\n\nRECORDED: this turn's instruction about ${names.join(", ")} is now stored and applies to every future batch. You may confirm that, briefly.`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
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
  const historyChars = messages.reduce((n, m) => n + messageText(m).length, 0);
  if (messages.length > MAX_MESSAGES || historyChars > MAX_HISTORY_CHARS) {
    return NextResponse.json(
      { error: "conversation history too large" },
      { status: 413 },
    );
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

  // Standing instructions stated plainly in this turn are written NOW, before
  // the assistant answers — pattern-matched, so there is no model call that can
  // 429 and leave the rule unwritten while the chat says "got it". Anything the
  // patterns don't recognise is still the session-end extractor's job.
  const recorded = await recordDirectives(user.id, userTurn);

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
    system: SYSTEM_PROMPT + dnaContext + recordedContext(recorded),
    messages: convertToCoreMessages(messages),
    maxTokens: MAX_REPLY_TOKENS,
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
