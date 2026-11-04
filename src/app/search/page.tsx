import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/modules/session/components/AppShell";
import SearchView from "./SearchView";

export const metadata = { title: "Search — WTW" };

/**
 * Menu → Search: find a title by name (the show someone at the office
 * mentioned) and add it to the watchlist. MVP, 2026-11-04: titles only, no
 * match score. Design: docs/prototypes/search/.
 */
export default async function SearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const appUser = {
    id: user.id,
    email: user.email ?? null,
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  return (
    <AppShell>
      {/* SearchView reads ?t= (the open card) with useSearchParams. */}
      <Suspense>
        <SearchView user={appUser} />
      </Suspense>
    </AppShell>
  );
}
