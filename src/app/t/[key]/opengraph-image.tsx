import { ImageResponse } from "next/og";
import { loadSharedTitle } from "./data";
import { LOGO_DATA_URI } from "./logo";

/**
 * The picture in a shared link's preview (WhatsApp, Messages…), as in
 * docs/prototypes/share/v3/7-whatsapp.jpg: poster on the left, title, year,
 * kind and rating beside it, the WTW mark under them, on the app's dark gold.
 */
export const alt = "A title shared from WTW";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Inter, as TTF (what the image renderer reads), for the weights used below.
 *  Google Fonts serves TTF to a client that doesn't ask for woff2. Null on any
 *  failure: the image then falls back to the renderer's own font. */
async function inter(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`)).text();
    const url = /src: url\((.+?)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const shared = await loadSharedTitle(key);
  const rec = shared?.rec;
  const line = rec ? [rec.year || null, rec.type === "tv" ? "Series" : "Movie"].filter(Boolean).join(" · ") : "";
  const [regular, bold] = await Promise.all([inter(500), inter(800)]);
  const fonts = [
    ...(regular ? [{ name: "Inter", data: regular, weight: 500 as const }] : []),
    ...(bold ? [{ name: "Inter", data: bold, weight: 800 as const }] : []),
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 72px",
          color: "#fff",
          fontFamily: "Inter",
          background:
            "radial-gradient(120% 90% at 85% 120%, rgba(212,155,58,0.55) 0%, rgba(212,155,58,0.15) 40%, rgba(0,0,0,0) 70%), #07060c",
        }}
      >
        {rec?.poster_url && (
          <img
            src={rec.poster_url}
            alt=""
            width={340}
            height={510}
            style={{ borderRadius: 18, objectFit: "cover", boxShadow: "0 18px 50px rgba(0,0,0,0.7)" }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: rec && rec.title.length > 28 ? 60 : 76, fontWeight: 800, lineHeight: 1.05 }}>
            {rec?.title ?? "WTW — What To Watch"}
          </div>
          {line && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, fontSize: 34, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>
              <span>{line}</span>
              {rec && rec.rating > 0 && (
                <>
                  <span>·</span>
                  {/* The star is drawn: the renderer's fonts have no ★. */}
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="#ffa900" style={{ marginLeft: 4, marginRight: 8 }}>
                    <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
                  </svg>
                  <span>{rec.rating.toFixed(1)}</span>
                </>
              )}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 64, fontSize: 40, fontWeight: 500, letterSpacing: 1 }}>
            <img src={LOGO_DATA_URI} alt="" width={84} height={84} style={{ margin: "-20px -16px" }} />
            <span>WTW</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
