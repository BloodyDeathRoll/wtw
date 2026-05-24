// Conversation API — Task #8 MVP.
// Auth-gated (Supabase session required), streams Groq/Llama 3.3 70B via the
// Vercel AI SDK. No DNA stitching or signal extraction yet — those land in
// later tasks. Response shape matches `useChat`'s data-stream protocol so the
// client wiring can drop in without server changes.

import { groq } from "@ai-sdk/groq";
import { streamText, type CoreMessage } from "ai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are WTW (What To Watch), a conversational film and TV recommendation assistant.

Reply conversationally and concisely (1–3 short paragraphs). When you suggest titles, name them inline in prose — do not output JSON, markdown tables, or any machine-readable structure. The structured recommendation engine is wired separately and will replace your free-text suggestions over time.

Ask one focused clarifying question when the user's request is ambiguous about mood, runtime, or who they're watching with.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { messages?: CoreMessage[] }
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
    messages,
  });

  return result.toDataStreamResponse();
}
