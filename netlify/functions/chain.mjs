/**
 * Public chain share proxy for the Ableton MCP package.
 * GET /api/chain/:id  →  shared_chains row (anon-readable via RLS)
 */

import { corsHeaders } from "./_shared/cors.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";
import { UUID_RE, fetchSharedChainRow } from "./_shared/supabase.mjs";

export async function handler(event) {
  const cors = {
    ...corsHeaders(event, { allowPublic: true }),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return jsonError(405, "Method not allowed", null, cors);
  }

  const rl = await rateLimit(event, {
    bucket: "chain",
    limit: 120,
    windowSec: 60,
    requireShared: false, // MCP clients; still limited in-memory / Upstash when present
  });
  if (!rl.ok) {
    return jsonError(rl.statusCode, rl.error, null, { ...cors, ...rateLimitHeaders(rl) });
  }

  const id = extractId(event);
  if (!UUID_RE.test(id)) {
    return jsonError(400, "Malformed chain id — expected a UUID.", null, cors);
  }

  try {
    const row = await fetchSharedChainRow(id);
    return jsonResponse(
      200,
      {
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
      },
      { ...cors, "Cache-Control": "public, max-age=60" }
    );
  } catch (err) {
    const status = err.status || 500;
    const publicMsg =
      status === 404
        ? err.message || "Chain not found."
        : status === 503
          ? "Share API is not configured."
          : "Could not load chain.";
    return jsonError(status, publicMsg, status >= 500 ? err : null, cors);
  }
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
