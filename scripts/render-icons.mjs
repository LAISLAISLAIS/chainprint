/**
 * Render brand icons (favicon sizes, apple-touch, icon-512) from the chain mark.
 * Usage: node scripts/render-icons.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = join(root, "scripts", ".og-tmp");
mkdirSync(tmp, { recursive: true });

const require = createRequire(import.meta.url);
let Resvg;
try {
  ({ Resvg } = require(join(tmp, "node_modules/@resvg/resvg-js")));
} catch {
  execSync("npm install --no-save --prefix scripts/.og-tmp @resvg/resvg-js", {
    stdio: "inherit",
    cwd: root,
  });
  ({ Resvg } = require(join(tmp, "node_modules/@resvg/resvg-js")));
}

function chainSvg(size, { rounded = true, padding = 0.18 } = {}) {
  const r = rounded ? Math.round(size * 0.18) : 0;
  // mark.svg viewBox content ~110×34 centered in square
  const markW = 110;
  const markH = 34;
  const scale = (size * (1 - padding * 2)) / markW;
  const drawW = markW * scale;
  const drawH = markH * scale;
  const tx = (size - drawW) / 2 - 10 * scale;
  const ty = (size - drawH) / 2 - 6 * scale;
  const sw = Math.max(2.2, 3.5 * (scale / 2.2));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#0a0a0a"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="#f4f4f4" stroke-width="${sw / scale}" stroke-linejoin="round" stroke-linecap="round">
    <rect x="10" y="6" width="14" height="28" rx="7"/>
    <rect x="18" y="13" width="42" height="14" rx="7"/>
    <rect x="54" y="6" width="14" height="28" rx="7"/>
    <rect x="62" y="13" width="42" height="14" rx="7"/>
    <rect x="96" y="6" width="14" height="28" rx="7"/>
  </g>
</svg>`;
}

function render(size, outName, opts) {
  const svg = chainSvg(size, opts);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  const out = join(root, "assets", outName);
  writeFileSync(out, png);
  console.log(`Wrote ${out} (${png.length} bytes)`);
}

render(180, "apple-touch-icon.png");
render(512, "icon-512.png");
render(48, "favicon-48.png");
render(32, "favicon-32.png");

// Compact 3-link favicon SVG (matches prior favicon density)
writeFileSync(
  join(root, "assets", "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Chainprint">
  <rect width="64" height="64" rx="12" fill="#0a0a0a"/>
  <g fill="none" stroke="#f4f4f4" stroke-width="3.25" stroke-linecap="round" stroke-linejoin="round">
    <rect x="8" y="18" width="12" height="28" rx="6"/>
    <rect x="14" y="25" width="36" height="14" rx="7"/>
    <rect x="44" y="18" width="12" height="28" rx="6"/>
  </g>
</svg>
`
);
console.log("Wrote assets/favicon.svg");
