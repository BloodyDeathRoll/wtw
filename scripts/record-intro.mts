// Records the games intro (GAMES_INTRO_MESSAGE) with Gemini TTS in the
// default Aoede voice and writes public/intro-games.mp3. One API call.
//
// Usage:  npm run record-intro      (needs ffmpeg on PATH)

import { GoogleGenAI, Modality } from "@google/genai";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODELS } from "../src/lib/ai-models";
import { GAMES_INTRO_AUDIO_SRC, GAMES_INTRO_MESSAGE } from "../src/modules/session/voice/intro-copy";

const VOICE = "Aoede";
const SAMPLE_RATE = 24_000; // Gemini TTS returns 16-bit mono PCM at 24 kHz

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY not set. Run via: npm run record-intro");

const ai = new GoogleGenAI({ apiKey });
// Framed as a read-aloud instruction so the model doesn't answer the question in it.
const result = await ai.models.generateContent({
  model: MODELS.tts,
  contents: `Say in a warm, upbeat voice:\n${GAMES_INTRO_MESSAGE}`,
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
  },
});
const base64 = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
if (!base64) throw new Error("response had no audio payload");

const raw = path.join(os.tmpdir(), "intro-games.pcm");
fs.writeFileSync(raw, Buffer.from(base64, "base64"));
const out = path.join(process.cwd(), "public", GAMES_INTRO_AUDIO_SRC.replace(/^\//, ""));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", raw, "-b:a", "64k", out]);
fs.unlinkSync(raw);
console.log(`wrote ${out}`);
