// Sanitises an OAuth `next` redirect target so it can only ever resolve to a
// path on our OWN origin. The value is appended to `origin` by the auth
// callback (`${origin}${next}`); without this guard a crafted `next` such as
// "@evil.com" or ".evil.com" injects an attacker-controlled host into the URL
// authority and turns the callback into an open redirect.
//
// Returns a path that is always safe to concatenate after `origin`. Anything
// that is not a plain, single-slash, same-origin absolute path collapses to "/".
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  // Must be an absolute path beginning with exactly one forward slash.
  if (next[0] !== "/") return "/"; // "@evil.com", ".evil.com", "https://evil.com"
  // Reject protocol-relative ("//evil.com") and the backslash variant browsers
  // normalise back to "//" ("/\evil.com").
  if (next[1] === "/" || next[1] === "\\") return "/";
  // Any backslash anywhere is a normalisation hazard — refuse it outright.
  if (next.includes("\\")) return "/";
  return next;
}

/** Where to land after an OAuth sign-in that started on a page other than the
 *  login screen (a shared title's "Save"). Read by the auth callback when the
 *  redirect carries no `next`, then cleared; always passed through safeNextPath. */
export const RETURN_COOKIE = "wtw_return_to";
