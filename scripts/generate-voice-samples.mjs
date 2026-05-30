// One-time generator for voice preview samples.
//
// Calls Gemini TTS once per voice and writes the result as a WAV under
// public/voice-samples/. Skips voices that already have files, so it's
// safe to re-run after the free-tier daily quota resets — it'll just
// pick up where it left off until all 30 are generated.
//
// Usage:
//   npm run generate-voice-samples
//
// Free-tier quota is ~10 requests/day per model, so the full set takes
// 3 days to generate from scratch. Once written, the WAV files are
// committed (no future API calls needed at runtime).

import { GoogleGenAI, Modality } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const SAMPLE_TEXT = "Hi! I'm your WTW guide. This is what I sound like.";
const OUTPUT_DIR = path.join(PROJECT_ROOT, "public", "voice-samples");

const VOICES = [
  "Aoede",
  "Charon",
  "Fenrir",
  "Kore",
  "Puck",
  "Zephyr",
  "Leda",
  "Orus",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      "GEMINI_API_KEY not set. Run via:  npm run generate-voice-samples",
    );
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ai = new GoogleGenAI({ apiKey });

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const voice of VOICES) {
    const outputPath = path.join(OUTPUT_DIR, `${voice}.wav`);
    try {
      await fs.access(outputPath);
      console.log(`· ${voice} — already exists`);
      skipped++;
      continue;
    } catch {
      // not present, generate
    }

    try {
      process.stdout.write(`→ ${voice}…`);
      const result = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: SAMPLE_TEXT,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      });
      const base64 =
        result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64) throw new Error("response had no audio payload");

      const pcm = Buffer.from(base64, "base64");
      const wav = pcmToWav(pcm);
      await fs.writeFile(outputPath, wav);
      console.log(` ok (${(wav.length / 1024).toFixed(1)} KB)`);
      generated++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(` FAILED`);
      console.error(`  ${msg}\n`);
      failed++;

      // Quota exhausted — bail so we don't hammer the API for nothing.
      // The user re-runs after the daily reset and we pick up where we
      // left off (files we already wrote are skipped on next pass).
      if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
        console.log(
          "Daily free-tier quota exhausted. Re-run tomorrow to continue.",
        );
        break;
      }
    }
  }

  console.log(
    `\nDone. ${generated} new, ${skipped} cached, ${failed} failed (of ${VOICES.length}).`,
  );
  if (generated + skipped < VOICES.length) {
    console.log("Re-run after quota reset to finish.");
  }
}

/** Wrap raw 24 kHz / 16-bit / mono PCM in a WAV header. */
function pcmToWav(pcm) {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
