// Welcome-screen helpers.
//
// Counts total fingerprint signals (chat turns + feedback rows) to decide
// whether the user is "mature" — past calibration — and if so generates a
// fresh, situational greeting via Groq so each visit feels personal rather
// than canned. The "knowledgeable friend" model: vary the angle, lean on
// time-of-day / day-of-week, never read from a fixed pool.

import { groq } from "@ai-sdk/groq";
import { MODELS } from "@/lib/ai-models";
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
  if (signals < MATURE_THRESHOLD) {
    return { greeting: null };
  }
  const greeting = await generateGreeting(name, utcOffsetMinutes);
  return { greeting };
}

async function countUserSignals(
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

async function generateGreeting(
  name: string | null,
  utcOffsetMinutes: number | null,
): Promise<string> {
  const displayName = (name?.trim().split(" ")[0] ?? "").trim() || "there";

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
      system: systemPrompt,
      prompt: `Greet ${displayName} and ask the question.`,
    });
    const text = result.text.trim();
    return text || `Hi ${displayName}, what are you in the mood for tonight?`;
  } catch (e) {
    console.error("[welcome] greeting generation failed", e);
    return `Hi ${displayName}, what are you in the mood for tonight?`;
  }
}
