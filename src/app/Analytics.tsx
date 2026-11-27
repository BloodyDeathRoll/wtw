"use client";

import Script from "next/script";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { GA_ID, identify, initAnalytics } from "@/lib/analytics";

/** Loads gtag.js, then tags the visit with the signed-in user's id once the session is read. */
export default function Analytics() {
  useEffect(() => {
    if (!GA_ID) return;
    initAnalytics();
    createClient().auth.getSession()
      .then(({ data }) => { if (data.session) identify(data.session.user.id); })
      .catch(() => {});
  }, []);

  if (!GA_ID) return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />;
}
