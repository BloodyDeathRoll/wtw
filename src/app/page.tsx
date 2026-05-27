import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateActiveConversation } from "@/lib/conversations";
import { buildWelcomeData } from "@/lib/welcome";
import WTWApp from "@/modules/session/components/WTWApp";
import type { AppUser } from "@/modules/session/types";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
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
  const [conversation, welcome] = await Promise.all([
    getOrCreateActiveConversation(supabase, user.id),
    buildWelcomeData(supabase, user.id, appUser.name, utcOffsetMinutes),
  ]);

  return (
    <WTWApp user={appUser} conversation={conversation} welcome={welcome} />
  );
}
