import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

// Site-wide response headers (audit 2026-09-11). The CSP is set per request in
// src/middleware.ts (it needs a nonce), report-only for now. Microphone stays
// allowed for voice mode.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Phone testing over the home Wi-Fi (`next dev` reached at the Mac's address): Next blocks other origins in dev.
  // Next's dev-tools button would sit over the For you tab on the phone, so it goes too.
  ...(process.env.DEV_LAN_HOST ? { allowedDevOrigins: [process.env.DEV_LAN_HOST], devIndicators: false as const } : {}),
  // v2 plan flags the client needs too (src/lib/flags.ts): inlined at build,
  // so changing one in Vercel takes a redeploy.
  env: {
    CHAT_MODE: process.env.CHAT_MODE ?? "",
    NAV_TABS: process.env.NAV_TABS ?? "",
    SEARCH_V3: process.env.SEARCH_V3 ?? "",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // next-pwa's default "apis" rule is NetworkFirst with a 10 s timeout: when
  // an /api call takes longer, the service worker answers with an OLD cached
  // response and the app shows it as fresh (a "Find more" that brings back the
  // previous batch). API responses are personal and never cacheable here.
  // Same cacheName as the default → this entry replaces it.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        options: { cacheName: "apis" },
      },
    ],
  },
})(nextConfig);
