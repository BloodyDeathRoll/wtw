// Regenerates the PWA icon set from the brand logo (public/wtw-logo.svg).
//
// Run after any logo change:
//   npm run generate-icons
//
// Outputs (all referenced by public/manifest.json / src/app/layout.tsx):
//   public/icon-192.png            192px, rounded #0a0a0a tile (manifest)
//   public/icon-512.png            512px, rounded tile (manifest)
//   public/icon-512-maskable.png   512px, square + extra padding — Android's
//                                  maskable safe zone (circular crops)
//   public/apple-touch-icon.png    180px, SQUARE — Apple's HIG says do NOT
//                                  pre-round; iOS applies its own corner mask
//
// sharp rasterizes via librsvg, which preserves the logo SVG's masks and
// Gaussian-blur gradient fills (PIL/canvas approaches can't).

import sharp from "sharp";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logoSvg = readFileSync(join(root, "public/wtw-logo.svg"));
const OUT = join(root, "public");
const ASPECT = 75.5821 / 71.2839; // logo h/w from its clipPath

async function tile(size, out, { logoFrac = 0.4, radiusFrac = 0.22 } = {}) {
  const logoW = Math.round(size * logoFrac);
  const logoH = Math.round(logoW * ASPECT);
  // density scales librsvg's 72dpi base so the raster is sharp at target size
  const logo = await sharp(logoSvg, { density: 72 * Math.ceil((logoW / 72) * 2) })
    .resize(logoW, logoH, { fit: "inside" })
    .png()
    .toBuffer();
  const r = Math.round(size * radiusFrac);
  const bg = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#0a0a0a"/></svg>`,
  );
  await sharp(bg)
    .png()
    .composite([{ input: logo, gravity: "centre" }])
    .toFile(join(OUT, out));
  console.log("wrote", out, `${size}px (logo ${logoW}x${logoH})`);
}

await tile(192, "icon-192.png");
await tile(512, "icon-512.png");
await tile(512, "icon-512-maskable.png", { logoFrac: 0.32, radiusFrac: 0 });
await tile(180, "apple-touch-icon.png", { radiusFrac: 0 });
