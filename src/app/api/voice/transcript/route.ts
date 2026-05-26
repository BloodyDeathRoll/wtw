// Voice transcript persistence — drops a completed voice turn (user
// transcript + AI transcript) into the same `messages` table the text
// chat writes to, so reloads + Assignment 3's DNA writer see one unified
// stream of signals regardless of input modality.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  saveMessage,
  updateConversationState,
} from "@/lib/conversations";
import type { ConversationStage } from "@/modules/session/types";

export const runtime = "nodejs";

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
