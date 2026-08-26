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

// Free tier is 3 requests/minute for this model, so ~21s of spacing keeps a run
// just under it. Both are env-overridable for a paid key, where the whole set
// finishes in one pass.
const RPM_SPACING_MS = Number(process.env.TTS_SPACING_MS ?? 21_000);
const RPM_RETRIES = Number(process.env.TTS_RPM_RETRIES ?? 3);

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
  let exhausted = false;

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

    // A 429 here is TWO different things wearing one status code, and the
    // difference decides whether to wait or to stop:
    //   • per-MINUTE (RPM, free tier = 3/min) — transient. The response
    //     carries RetryInfo.retryDelay; sleeping it through lets the run
    //     continue. Treating it as fatal is why a run stopped at 4 of 30.
    //   • per-DAY — genuinely out of road until the quota resets.
    // classifyQuotaError() below reads quotaId/quotaMetric to tell them apart.
    let attempt = 0;
    // Some voices (Zephyr, seen 2026-08-26) answer a bare transcript with
    // 400 "Model tried to generate text" — the model treated the sample as a
    // prompt to reply to. Retry once with the transcript framed as a read-aloud
    // instruction so it has nothing to answer. UNVERIFIED: the daily quota was
    // gone before this could be tried; if Zephyr still fails, swap the voice.
    let contents = SAMPLE_TEXT;
    for (;;) {
      try {
        process.stdout.write(`→ ${voice}…`);
        const result = await ai.models.generateContent({
          model: TTS_MODEL,
          contents,
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
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const quota = classifyQuotaError(msg);

        if (/tried to generate text/i.test(msg) && contents === SAMPLE_TEXT) {
          contents = `Read the following aloud, exactly as written: "${SAMPLE_TEXT}"`;
          console.log(` model replied with text, retrying as a read-aloud instruction`);
          await sleep(RPM_SPACING_MS);
          continue;
        }

        if (quota.kind === "per-minute" && attempt < RPM_RETRIES) {
          attempt++;
          const waitMs = quota.retryMs ?? 60_000;
          console.log(
            ` rate-limited, waiting ${Math.ceil(waitMs / 1000)}s` +
              ` (retry ${attempt}/${RPM_RETRIES})`,
          );
          await sleep(waitMs + 1_000); // +1s of slack against clock skew
          continue;
        }

        console.log(` FAILED`);
        console.error(`  ${msg}\n`);
        failed++;

        if (quota.kind === "per-day") {
          console.log(
            "Daily free-tier quota exhausted. Re-run tomorrow to continue.",
          );
          exhausted = true;
        } else if (quota.kind === "per-minute") {
          console.log(
            `Still rate-limited after ${RPM_RETRIES} retries — stopping.` +
              " Re-run to continue; finished voices are skipped.",
          );
          exhausted = true;
        }
        break;
      }
    }
    if (exhausted) break;

    // Stay under the free-tier RPM instead of sprinting into a 429 and
    // recovering from it — cheaper than the retry it avoids.
    await sleep(RPM_SPACING_MS);
  }

  console.log(
    `\nDone. ${generated} new, ${skipped} cached, ${failed} failed (of ${VOICES.length}).`,
  );
  if (generated + skipped < VOICES.length) {
    console.log("Re-run after quota reset to finish.");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Tell a per-minute 429 from a per-day one, and pull the server's own retry
 * delay when it offers one.
 *
 * The SDK stringifies the JSON error body into e.message, so this parses what
 * it can and falls back to substring checks. Google names the free-tier RPM
 * quota `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` and the daily
 * one `...PerDay...`; when neither appears we return "per-minute", because
 * waiting on a genuinely daily limit costs one wasted minute, while quitting on
 * a per-minute limit costs the rest of the run.
 */
function classifyQuotaError(msg) {
  if (!/RESOURCE_EXHAUSTED|429/.test(msg)) return { kind: "other" };

  let retryMs = null;
  const retry = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (retry) retryMs = Math.ceil(parseFloat(retry[1]) * 1000);

  if (/PerDay|per_day|generate_content_free_tier_requests_per_day/i.test(msg)) {
    return { kind: "per-day", retryMs };
  }
  return { kind: "per-minute", retryMs };
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
