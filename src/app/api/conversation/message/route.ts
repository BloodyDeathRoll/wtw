// Conversation API — Task #8 MVP.
// Auth-gated (Supabase session required), streams Groq/Llama 3.3 70B via the
// Vercel AI SDK. No DNA stitching or signal extraction yet — those land in
// later tasks. Response shape matches `useChat`'s data-stream protocol so the
// client wiring can drop in without server changes.

import { groq } from "@ai-sdk/groq";
import { convertToCoreMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
- The structured recommendation engine isn't wired yet; any title you name is a placeholder, not a final pick.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { messages?: UIMessage[] }
    | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages must be a non-empty array" },
      { status: 400 },
    );
  }

  const result = streamText({
    model: groq("llama-3.3-70b-versatile"),
    system: SYSTEM_PROMPT,
    messages: convertToCoreMessages(messages),
  });

  return result.toDataStreamResponse();
}
