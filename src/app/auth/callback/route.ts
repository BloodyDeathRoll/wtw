import { createClient } from "@/lib/supabase/server";
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

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(`${origin}${next}`);
      if (returnTo) res.cookies.delete(RETURN_COOKIE);
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
