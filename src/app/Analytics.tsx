"use client";

import Script from "next/script";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { GA_ID, identify, initAnalytics } from "@/lib/analytics";

/** Loads gtag.js and tags the visit with the signed-in user's id, following sign-in and sign-out. */
export default function Analytics() {
  useEffect(() => {
    if (!GA_ID) return;
    const supabase = createClient();
    // The first page view carries the user id when the session is read in time;
    // a session read that stalls must not hold the analytics back for long.
    const session = supabase.auth.getSession().then(({ data }) => data.session?.user.id ?? null).catch(() => null);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500));
    Promise.race([session, timeout]).then(initAnalytics);
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_IN") identify(s?.user.id ?? null);
      if (event === "SIGNED_OUT") identify(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!GA_ID) return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />;
}
