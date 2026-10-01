// Voice transcript persistence — drops a completed voice turn (user
// transcript + AI transcript) into the same `messages` table the text
// chat writes to, so reloads + Assignment 3's DNA writer see one unified
// stream of signals regardless of input modality.

import { NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import {
  saveMessage,
  updateConversationState,
} from "@/lib/conversations";
import type { ConversationStage } from "@/modules/session/types";

export const runtime = "nodejs";

// One voice turn is a few sentences; 4K characters per side is generous and
// longer text is truncated. Unbounded text and an unchecked stage used to go
// straight into the user's conversation (swarm audit 2026-09-11).
const MAX_CONTENT = 4 * 1024;
/** Cut to `max` UTF-16 units without splitting a surrogate pair (an emoji). */
function truncate(text: string, max: number): string {
  const end = /[\uD800-\uDBFF]/.test(text[max - 1]) ? max - 1 : max;
  return text.slice(0, end);
}

const STAGES: readonly ConversationStage[] = ["onboard", "welcome", "conversation"];

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logAuthFailure("/api/voice/transcript");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        conversation_id?: string;
        user_content?: string;
        assistant_content?: string;
        stage?: ConversationStage;
      }
    | null;

  if (!body?.conversation_id) {
    return NextResponse.json(
      { error: "conversation_id required" },
      { status: 400 },
    );
  }
  for (const field of ["user_content", "assistant_content"] as const) {
    const v = body[field];
    if (v != null && typeof v !== "string") {
      return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
    }
    // Truncate rather than reject: a long turn should still be saved.
    if (typeof v === "string" && v.length > MAX_CONTENT) body[field] = truncate(v, MAX_CONTENT);
  }
  if (body.stage != null && !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  }

  try {
    if (body.user_content) {
      await saveMessage(
        supabase,
        body.conversation_id,
        "user",
        body.user_content,
      );
    }
    if (body.assistant_content) {
      await saveMessage(
        supabase,
        body.conversation_id,
        "assistant",
        body.assistant_content,
      );
    }
    if (body.stage) {
      await updateConversationState(supabase, body.conversation_id, {
        stage: body.stage,
      });
    }
  } catch (e) {
    console.error("[voice/transcript] save failed", e);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
