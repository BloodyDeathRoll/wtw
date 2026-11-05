/**
 * Who is signed in, from the JWT — no round trip to Supabase Auth.
 *
 * `supabase.auth.getUser()` calls the Auth server on every request. The
 * database is in Sydney and the functions in Frankfurt, so that is ~300 ms
 * before anything else can start — on every page and on every API call
 * (measured 2026-11-05, docs/speed-plan.md part B). `getClaims()` verifies
 * the access token's signature locally against the project's JWKS (ES256,
 * fetched once per function instance and cached), checks `exp`, and refreshes
 * an expired session the same way `getUser()` does.
 *
 * What changes in trust: a session revoked server-side (sign-out everywhere,
 * a banned user) stays valid here until the token expires (1 hour). Nothing
 * in this app needs tighter than that; use `getUser()` where it does.
 *
 * The claims carry `sub`, `email` and `user_metadata` (name, avatar), which
 * is all the pages read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
}

export async function getAuthUser(supabase: SupabaseClient): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
  };
}
