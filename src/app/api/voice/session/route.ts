// Voice session API — issues an ephemeral Gemini Live token.
//
// The browser cannot hold GEMINI_API_KEY safely, so we mint a short-lived,
// single-use token here and the client uses it to connect directly to Google.
// We also lock the model + system prompt + AUDIO modality into the token so
// the client can only open a voice session with the exact contract we want.

import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_MODEL = "gemini-live-2.5-flash-preview";

const SYSTEM_PROMPT = `You are WTW (What To Watch) — a friendly conversational guide helping the user calibrate their film and TV taste through a short voice conversation.

Have a natural, two-way conversation. Ask one focused question at a time about their viewing habits — favourite directors, the moods they crave, what they last loved, what they always avoid. Listen carefully, follow up on what they say, and gently steer toward signals that distinguish their taste from the average viewer.

This is voice. Keep every reply to 1–2 short sentences. Do not list options. Do not output URLs, markdown, or formatted text. When the user is ready to see recommendations, they will tap a button — do not try to recommend titles during the calibration conversation.`;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  // Tokens are single-use and short-lived. We give the client ~2 min to open
  // the WebSocket; once connected the session itself can run for the full
  // Gemini Live duration.
  const expireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      liveConnectConstraints: {
        model: VOICE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_PROMPT,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
      // Empty array means: lock exactly the fields above; client cannot change them.
      lockAdditionalFields: [],
    },
  });

  return NextResponse.json({
    token: token.name,
    model: VOICE_MODEL,
    expiresAt: expireTime,
  });
}
