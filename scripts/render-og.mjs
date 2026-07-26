/**
 * Render assets/og-image.png from brand mark geometry + Syne.
 * Usage: node scripts/render-og.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPng = join(root, "assets", "og-image.png");
const outCard = join(root, "assets", "og-card.png");
const tmp = join(root, "scripts", ".og-tmp");
mkdirSync(tmp, { recursive: true });

function downloadFont(familyCss, outBase) {
  const existing = ["ttf", "otf", "woff2"]
    .map((ext) => join(tmp, `${outBase}.${ext}`))
    .find((p) => existsSync(p));
  if (existing) return existing;
  const css = execSync(
    `curl -fsSL -A "Mozilla/5.0" "${familyCss}"`,
    { encoding: "utf8" }
  );
  const url =
    css.match(/url\((https:\/\/[^)]+\.ttf)\)/)?.[1] ||
    css.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
  if (!url) throw new Error(`Could not resolve font URL for ${outBase}`);
  const ext = url.includes(".woff2") ? "woff2" : "ttf";
  const dest = join(tmp, `${outBase}.${ext}`);
  execSync(`curl -fsSL -A "Mozilla/5.0" -o "${dest}" "${url}"`);
  return dest;
}

downloadFont(
  "https://fonts.googleapis.com/css2?family=Syne:wght@700&display=swap",
  "Syne-Bold"
);
downloadFont(
  "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,500&display=swap",
  "DMSans-Medium"
);

const require = createRequire(import.meta.url);
let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
} catch {
  execSync("npm install --no-save --prefix scripts/.og-tmp @resvg/resvg-js", {
    stdio: "inherit",
    cwd: root,
  });
  ({ Resvg } = require(join(tmp, "node_modules/@resvg/resvg-js")));
}

const fontFiles = [];
for (const name of [
  "Syne-Bold.ttf",
  "Syne-Bold.woff2",
  "Syne-Bold.otf",
  "DMSans-Medium.ttf",
  "DMSans-Medium.woff2",
  "DMSans-Medium.otf",
]) {
  const p = join(tmp, name);
  if (existsSync(p)) fontFiles.push(p);
}

// Brand chain: alternating vertical / horizontal capsule links (same as assets/mark.svg)
// mark.svg viewBox ~120×40; scale ×2.8 → ~336×112, centered on 1200×630.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#000000"/>
  <g transform="translate(432 148) scale(2.8)" fill="none" stroke="#f4f4f4" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">
    <rect x="10" y="6" width="14" height="28" rx="7"/>
    <rect x="18" y="13" width="42" height="14" rx="7"/>
    <rect x="54" y="6" width="14" height="28" rx="7"/>
    <rect x="62" y="13" width="42" height="14" rx="7"/>
    <rect x="96" y="6" width="14" height="28" rx="7"/>
  </g>
  <text x="600" y="330" text-anchor="middle" font-family="Syne" font-weight="700" font-size="92" letter-spacing="-3.5" fill="#f7f7f7">Chainprint</text>
  <text x="600" y="392" text-anchor="middle" font-family="DM Sans" font-weight="500" font-size="28" letter-spacing="-0.2" fill="#9a9a9a">Recreate any mix in your DAW.</text>
</svg>`;

const svgPath = join(tmp, "og.svg");
writeFileSync(svgPath, svg);

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: {
    fontFiles,
    loadSystemFonts: true,
    defaultFontFamily: "Syne",
  },
  background: "black",
});
const png = resvg.render().asPng();
writeFileSync(outPng, png);
writeFileSync(outCard, png);
console.log(`Wrote ${outPng} and ${outCard} (${png.length} bytes)`);
