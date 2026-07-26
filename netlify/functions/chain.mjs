/**
 * Public chain share proxy for the Ableton MCP package.
 * GET /api/chain/:id  →  shared_chains row (anon-readable via RLS)
 *
 * Keeps Supabase keys out of the Python package — MCP clients hit this endpoint.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    body: JSON.stringify(body),
  };
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
  ).trim();
  // Fallback to the public project used by the static site (anon key is already public)
  return {
    url: url || "https://wggvvgigtwzwivpgszyr.supabase.co",
    key: key || "sb_publishable_mGJIAlOvSs_5sahA8i0qiQ_q5gskCtM",
  };
}

function extractId(event) {
  const q = event.queryStringParameters || {};
  if (q.id) return String(q.id).trim();
  const path = String(event.path || "");
  const m = path.match(/\/(?:api\/)?chain\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]).trim();
  // Netlify function path style
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

  const { url, key } = supabaseConfig();
  if (!url || !key) {
    return json(503, { error: "Sharing backend not configured." });
  }

  const endpoint =
    `${url}/rest/v1/shared_chains` +
    `?id=eq.${encodeURIComponent(id)}` +
    `&select=id,track_name,target,mode,key_label,bpm,artwork_url,payload,created_at`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      return json(502, { error: "Upstream share lookup failed." });
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      return json(404, { error: "Chain not found." });
    }
    const row = rows[0];
    return json(200, {
      id: row.id,
      track_name: row.track_name,
      target: row.target,
      mode: row.mode,
      key_label: row.key_label,
      bpm: row.bpm,
      artwork_url: row.artwork_url,
      created_at: row.created_at,
      payload: row.payload,
    });
  } catch (err) {
    return json(500, { error: err?.message || "Could not load chain." });
  }
}
