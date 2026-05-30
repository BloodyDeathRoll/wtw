import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "WTW — What To Watch",
  description: "AI-powered film and TV recommendations that actually know you.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans`}>
        {/* Write the browser's UTC offset so the server can render
            time-of-day-aware greetings on the next request. Browser semantics
            (minutes behind UTC). 1-year cookie; refreshed every load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.cookie='tz_offset='+new Date().getTimezoneOffset()+'; path=/; max-age=31536000; samesite=lax';`,
          }}
        />
        {/* next-pwa is disabled in dev, but a SW from a prior production build
            can linger in the browser and serve stale HTML. Tear it down on
            every dev page load. */}
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));}`,
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
