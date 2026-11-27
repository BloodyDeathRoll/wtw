import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { RETURN_COOKIE, safeNextPath } from "@/lib/safe-redirect";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` is attacker-controllable; sanitise to a same-origin path before
  // concatenating onto `origin` (otherwise "@evil.com" → open redirect).
  // A sign-in started from a shared title's "Save" comes back to that page
  // (src/app/t): the page leaves its path in a short-lived cookie, since the
  // OAuth redirect URL itself stays fixed.
  const cookieStore = await cookies();
  const returnTo = cookieStore.get(RETURN_COOKIE)?.value;
  const next = safeNextPath(searchParams.get("next") ?? returnTo);

  // Closed beta: the Auth hook (migration 0040) refuses an unlisted email's sign-up,
  // and Supabase sends the refusal back here instead of a code.
  const refused = `${searchParams.get("error_description") ?? ""} ${searchParams.get("error") ?? ""}`;
  if (/not_approved/.test(refused)) {
    return NextResponse.redirect(`${origin}/login?error=not-approved`);
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Every sign-in, not only sign-ups: an email taken off the list loses access too.
      // A failed check fails closed.
      const { data: approved, error: listError } = await createServiceClient()
        .rpc("is_beta_approved", { p_email: data.user?.email ?? "" });
      if (listError || approved !== true) {
        if (listError) console.error("[auth/callback] is_beta_approved failed", listError);
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=not-approved`);
      }
      const res = NextResponse.redirect(`${origin}${next}`);
      if (returnTo) res.cookies.delete(RETURN_COOKIE);
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
