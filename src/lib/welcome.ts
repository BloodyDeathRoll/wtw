// Welcome-screen helpers.
//
// Counts total fingerprint signals (chat turns + feedback rows) to decide
// whether the user is "mature" — past calibration — and if so generates a
// fresh, situational greeting via Groq so each visit feels personal rather
// than canned. The "knowledgeable friend" model: vary the angle, lean on
// time-of-day / day-of-week, never read from a fixed pool.

import { groq } from "@ai-sdk/groq";
import { MODELS, GROQ_TEXT_OPTIONS } from "@/lib/ai-models";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

const MATURE_THRESHOLD = 10;

export interface WelcomeData {
  /** LLM-generated greeting when the user has crossed the maturity bar.
   *  null = still calibrating (use the standard calibration prompt). */
  greeting: string | null;
}

export async function buildWelcomeData(
  supabase: SupabaseClient,
  userId: string,
  name: string | null,
  /** Browser-style offset in minutes (minutes behind UTC — Tel Aviv = -180).
   *  Null on first-ever visit before the client has set the tz cookie; the
   *  greeting then omits time-of-day context rather than guessing wrong. */
  utcOffsetMinutes: number | null = null,
): Promise<WelcomeData> {
  const signals = await countUserSignals(supabase, userId);
  return welcomeForSignals(userId, signals, name, utcOffsetMinutes);
}

/** How long one greeting is reused: the time-of-day wording is right for
 *  about a quarter of a day, and a fresh Groq call per home load was ~0.7 s. */
const GREETING_TTL_S = 4 * 60 * 60;

/**
 * The greeting for a signal count the caller already has (the home page gets
 * it from `home_bootstrap()`). Cached in Redis per user and quarter of the
 * user's local day, so a mature user's home page does not wait on Groq on
 * every load. Cache trouble is never fatal: the greeting is generated anyway.
 */
export async function welcomeForSignals(
  userId: string,
  signals: number,
  name: string | null,
  utcOffsetMinutes: number | null = null,
): Promise<WelcomeData> {
  if (signals < MATURE_THRESHOLD) {
    return { greeting: null };
  }
  const localHour = utcOffsetMinutes === null
    ? null
    : new Date(Date.now() - utcOffsetMinutes * 60_000).getUTCHours();
  const key = `greeting:${userId}:${localHour === null ? "any" : Math.floor(localHour / 6)}`;
  // Lazy: `@/lib/redis` is server-only and not every importer of this file
  // (play page, tests) wants it loaded.
  const redis = await import("@/lib/redis").then((m) => m.getRedis()).catch(() => null);
  if (redis) {
    const cached = await redis.get<unknown>(key).catch(() => null);
    if (typeof cached === "string" && cached) return { greeting: cached };
  }
  // Only a real generation is cached: a Groq outage must not pin the canned
  // line for 4 h.
  const generated = await generateGreeting(name, utcOffsetMinutes);
  if (generated && redis) await redis.set(key, generated, { ex: GREETING_TTL_S }).catch(() => {});
  return { greeting: generated ?? `Hi ${firstName(name)}, what are you in the mood for tonight?` };
}

const firstName = (name: string | null) => (name?.trim().split(" ")[0] ?? "").trim() || "there";

/** Chat turns + feedback rows. Also tells an existing user from a brand-new one. */
export async function countUserSignals(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  // The feedback count and conversation list are independent — fan them out.
  // The message count then has to wait for the conversation ids.
  const [{ count: feedbackCount }, { data: convos }] = await Promise.all([
    supabase
      .from("recommendation_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.from("conversations").select("id").eq("user_id", userId),
  ]);

  const ids = (convos ?? []).map((c) => c.id as string);
  let messageCount = 0;
  if (ids.length > 0) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", ids)
      .eq("role", "user");
    messageCount = count ?? 0;
  }

  return (feedbackCount ?? 0) + messageCount;
}

/** The Groq greeting, or null when it failed or came back empty. */
async function generateGreeting(
  name: string | null,
  utcOffsetMinutes: number | null,
): Promise<string | null> {
  const displayName = firstName(name);

  // When we have the client's offset, shift "now" to the user's local clock
  // and read fields in UTC so the rendered values reflect their wall time.
  // Without an offset we'd be reading the server's clock (UTC on Vercel) and
  // pinning the wrong time-of-day on the prompt — so we drop the context
  // entirely instead.
  let timeContextLine: string;
  if (utcOffsetMinutes === null) {
    timeContextLine = "";
  } else {
    const local = new Date(Date.now() - utcOffsetMinutes * 60_000);
    const hour = local.getUTCHours();
    const dayName = local.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "UTC",
    });
    const dayIndex = local.getUTCDay();
    const isWeekend = dayIndex === 0 || dayIndex === 6;
    const isFriday = dayIndex === 5;

    const timeOfDay =
      hour < 5
        ? "late night"
        : hour < 12
          ? "morning"
          : hour < 17
            ? "afternoon"
            : hour < 21
              ? "evening"
              : "night";

    const dayContext = isWeekend
      ? "weekend"
      : isFriday
        ? "Friday — winding-down energy"
        : "weekday";

    timeContextLine = `\n\nContext for THIS visit (use it to set tone — do NOT restate it):\n- It's ${timeOfDay} on a ${dayName} (${dayContext}).`;
  }

  const systemPrompt = `You are WTW (What To Watch). The user just opened the app — greet them by first name and ask ONE specific, situational question to start a conversation about what they should watch RIGHT NOW.${timeContextLine}

Voice:
- Like a knowledgeable, casual friend. Specific. Warm. Never canned.
- One or two short sentences. ~20 words max total.
- Vary the angle randomly each time — pick ONE from: current mood, who they're watching with, time they have, comfort vs new territory, recent vibe, a director or actor they'd trust, runtime sweet spot, an attribute they're avoiding lately, etc. Don't always reach for "mood".
- Don't open with phrases that sound automatic ("Hey there!", "Hope you're well").

Hard rules:
- Greet by first name.
- Plain prose only. No emojis. No quotes around the question. No bullet points.
- Don't reference the time of day or day of week unless you naturally weave it in.`;

  try {
    const result = await generateText({
      model: groq(MODELS.text),
      providerOptions: GROQ_TEXT_OPTIONS,
      instructions: systemPrompt,
      prompt: `Greet ${displayName} and ask the question.`,
    });
    return result.text.trim() || null;
  } catch (e) {
    console.error("[welcome] greeting generation failed", e);
    return null;
  }
}
