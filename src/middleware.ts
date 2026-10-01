import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Content-Security-Policy, REPORT-ONLY (swarm audit 2026-09-11 proposal).
// Nothing is blocked yet: violations go to /api/csp-report and show in the
// function logs. Enforce (rename the header) once a week of reports is clean.
// Next reads the nonce from this request header and stamps its own inline
// scripts; the tz_offset script in layout.tsx is static, so it is hashed.
const TZ_SCRIPT_HASH = "'sha256-OcDdGZajAurFrd1rAkKOF0gUxHP6aYWi+75Kri5Wsss='";

function contentSecurityPolicy(nonce: string): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseWs = supabase.replace(/^https:/, "wss:");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TZ_SCRIPT_HASH}`,
    "style-src 'self' 'unsafe-inline'",
    // TMDB posters/logos; Google avatars (AppMenu); data: for inline icons.
    "img-src 'self' data: blob: https://image.tmdb.org https://*.googleusercontent.com",
    "font-src 'self'",
    // Supabase auth/realtime; Gemini Live's voice WebSocket (VoiceMode.tsx).
    `connect-src 'self' ${supabase} ${supabaseWs} https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  // Rebuilt on each call: setAll() below rewrites request.cookies, and the
  // refreshed cookies must reach the page along with the nonce.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("content-security-policy-report-only", csp);
    return { request: { headers } };
  };

  let supabaseResponse = NextResponse.next(forward());

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next(forward());
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session without redirecting — keeps the token alive
  await supabase.auth.getUser();

  supabaseResponse.headers.set("Content-Security-Policy-Report-Only", csp);
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
