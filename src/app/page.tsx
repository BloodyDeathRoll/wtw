import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  return <WTWApp user={appUser} />;
}
