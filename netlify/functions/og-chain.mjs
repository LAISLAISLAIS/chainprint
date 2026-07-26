/**
 * Dynamic Open Graph image for a shared chain (SVG).
 * GET /api/og/:id
 */

import {
  UUID_RE,
  escapeHtml,
  fetchSharedChainRow,
  shareMeta,
  targetLabel,
} from "./_shared/supabase.mjs";

function extractId(event) {
  const q = event.queryStringParameters || {};
  if (q.id) return String(q.id).trim();
  const path = String(event.path || event.rawUrl || "");
  const m = path.match(/\/(?:api\/)?og\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]).trim();
  return "";
}

function svgFor(row, meta) {
  const title = String(row.track_name || "Shared chain").slice(0, 42);
  const subtitle = meta.chipLine || targetLabel(row.target);
  const titleSize = title.length > 28 ? 52 : 64;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#000000"/>
  <g transform="translate(80 72) scale(1.6)" fill="none" stroke="#f4f4f4" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">
    <rect x="10" y="6" width="14" height="28" rx="7"/>
    <rect x="18" y="13" width="42" height="14" rx="7"/>
    <rect x="54" y="6" width="14" height="28" rx="7"/>
    <rect x="62" y="13" width="42" height="14" rx="7"/>
    <rect x="96" y="6" width="14" height="28" rx="7"/>
  </g>
  <text x="80" y="220" font-family="Arial Narrow, Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="28" letter-spacing="2" fill="#8a8a8a">CHAINPRINT</text>
  <text x="80" y="320" font-family="Arial Narrow, Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="${titleSize}" fill="#f7f7f7">${escapeHtml(title)}</text>
  <text x="80" y="380" font-family="Helvetica Neue, Arial, sans-serif" font-weight="500" font-size="28" fill="#9a9a9a">${escapeHtml(subtitle)}</text>
  <text x="80" y="540" font-family="Helvetica Neue, Arial, sans-serif" font-weight="500" font-size="22" fill="#6e6e6e">Recreate any mix in your DAW.</text>
</svg>`;
}

function fallbackSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#000000"/>
  <text x="600" y="300" text-anchor="middle" font-family="Arial Narrow, Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="72" fill="#f7f7f7">Chainprint</text>
  <text x="600" y="360" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="28" fill="#9a9a9a">Recreate any mix in your DAW.</text>
</svg>`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  const id = extractId(event);
  let body = fallbackSvg();
  let status = 200;

  if (UUID_RE.test(id)) {
    try {
      const row = await fetchSharedChainRow(id);
      body = svgFor(row, shareMeta(row));
    } catch {
      status = 404;
      body = fallbackSvg();
    }
  }

  return {
    statusCode: status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "Access-Control-Allow-Origin": "*",
    },
    body,
  };
}
