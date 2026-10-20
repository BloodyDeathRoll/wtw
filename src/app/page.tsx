import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateActiveConversation } from "@/lib/conversations";
import { buildWelcomeData } from "@/lib/welcome";
import { PLAY_ONBOARDING_LIVE } from "@/lib/play-rollout";
import { loadPlay, progressOf } from "./play/lib/server";
import WTWApp from "@/modules/session/components/WTWApp";
import type { AppUser } from "@/modules/session/types";
import LoginScreen from "./login/LoginScreen";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; from?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out visitors get the public homepage in place — no redirect.
  // Google's site-verification crawler fetches the root URL anonymously and
  // must receive a 200 with the verification meta tag, not a 307 to /login.
  if (!user) {
    return <LoginScreen />;
  }

  // The taste games are the way in (src/lib/play-rollout.ts): genres before
  // anything, then the season until it's finished or skipped. A link back out
  // of the games (?from=play, ?stage=…) is never bounced back to them.
  // Started now, awaited with the other reads below (only the redirect needs it first).
  const playLoad = loadPlay(supabase, user.id).then((p) => progressOf(p.state));
  if (PLAY_ONBOARDING_LIVE) {
    const play = await playLoad;
    const params = await searchParams;
    const fromApp = params.from === "play" || !!params.stage;
    if (!play.genresDone || (!play.done && !play.skipped && !fromApp)) redirect("/play");
  }

  // Browser-style UTC offset written by the inline script in layout.tsx.
  // Absent on the very first visit — buildWelcomeData falls back to a
  // greeting without time-of-day context in that case.
  const tzCookie = (await cookies()).get("tz_offset")?.value;
  const parsedOffset = tzCookie === undefined ? NaN : Number(tzCookie);
  const utcOffsetMinutes = Number.isFinite(parsedOffset) ? parsedOffset : null;

  const appUser: AppUser = {
    id: user.id,
    email: user.email ?? null,
    name:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      null,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ??
      (user.user_metadata?.picture as string | undefined) ??
      null,
  };

  // Independent — fan out to shave the Groq round-trip off `buildWelcomeData`
  // when it lands during the conversation fetch.
  const [conversation, welcome, play] = await Promise.all([
    getOrCreateActiveConversation(supabase, user.id),
    buildWelcomeData(supabase, user.id, appUser.name, utcOffsetMinutes),
    playLoad,
  ]);

  return (
    <WTWApp
      user={appUser}
      conversation={conversation}
      welcome={welcome}
      calibrationNudge={play.skipped}
    />
  );
}
