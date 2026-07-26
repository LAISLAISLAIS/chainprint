/**
 * Public chain share proxy for the Ableton MCP package.
 * GET /api/chain/:id  →  shared_chains row (anon-readable via RLS)
 */

import { UUID_RE, fetchSharedChainRow } from "./_shared/supabase.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    body: JSON.stringify(body),
  };
}

function extractId(event) {
  const q = event.queryStringParameters || {};
  if (q.id) return String(q.id).trim();
  const path = String(event.path || "");
  const m = path.match(/\/(?:api\/)?chain\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]).trim();
  const raw = event.rawUrl || event.rawPath || "";
  const m2 = String(raw).match(/\/chain\/([^/?#]+)/i);
  if (m2) return decodeURIComponent(m2[1]).trim();
  return "";
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const id = extractId(event);
  if (!UUID_RE.test(id)) {
    return json(400, { error: "Malformed chain id — expected a UUID." });
  }

  try {
    const row = await fetchSharedChainRow(id);
    return json(200, {
      id: row.id,
      track_name: row.track_name,
      target: row.target,
      mode: row.mode,
      key_label: row.key_label,
      bpm: row.bpm,
      artwork_url: row.artwork_url,
      created_at: row.created_at,
      expires_at: row.expires_at ?? null,
      payload: row.payload,
    });
  } catch (err) {
    return json(err.status || 500, { error: err?.message || "Could not load chain." });
  }
}
