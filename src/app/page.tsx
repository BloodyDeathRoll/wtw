import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { loadHomeBootstrap } from "@/lib/home-bootstrap";
import { welcomeForSignals } from "@/lib/welcome";
import { PLAY_ONBOARDING_LIVE } from "@/lib/play-rollout";
import { progressOf } from "./play/lib/server";
import WTWApp from "@/modules/session/components/WTWApp";
import type { AppUser } from "@/modules/session/types";
import LoginScreen from "./login/LoginScreen";
import JevNotice from "./components/JevNotice";
import { devJevFailures } from "@/lib/jev";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; from?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);

  // Signed-out visitors get the public homepage in place — no redirect.
  // Google's site-verification crawler fetches the root URL anonymously and
  // must receive a 200 with the verification meta tag, not a 307 to /login.
  if (!user) {
    return <LoginScreen />;
  }

  // The taste games are the way in (src/lib/play-rollout.ts): genres before
  // anything, then the season until it's finished or skipped. A link back out
  // of the games (?from=play, ?stage=…) is never bounced back to them.
  // One round trip for everything the screen reads (conversation, messages,
  // signal counts, play state): migration 0027, docs/speed-plan.md part D.
  const boot = await loadHomeBootstrap(supabase, user.id);
  const play = progressOf(boot.play.state);
  if (PLAY_ONBOARDING_LIVE) {
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

  // The greeting (Groq, cached) and the dev notice (Redis) are independent.
  const [welcome, jevFailures] = await Promise.all([
    welcomeForSignals(user.id, boot.signals, appUser.name, utcOffsetMinutes),
    // Jev failures since this dev last dismissed the notice; [] for everyone else.
    devJevFailures(appUser.email),
  ]);

  return (
    <>
      {jevFailures.length > 0 && <JevNotice failures={jevFailures} />}
      <WTWApp
        user={appUser}
        conversation={boot.conversation}
        welcome={welcome}
        calibrationNudge={play.skipped}
      />
    </>
  );
}
