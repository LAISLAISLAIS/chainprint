/**
 * Shared Supabase helpers for Netlify functions (anon, user JWT, or service role).
 * No hardcoded project fallbacks — missing env fails closed.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
  ).trim();
  if (!url || !key) {
    const err = new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
    err.status = 503;
    throw err;
  }
  return { url, key };
}

export function supabaseServiceConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    const err = new Error(
      "Supabase service role is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
    err.status = 503;
    throw err;
  }
  return { url, key };
}

export function siteOrigin(event) {
  const fromEnv = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host = event.headers?.["x-forwarded-host"] || event.headers?.host || "localhost";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export async function supabaseRest(path, { service = false, token, method = "GET", body, headers: extra } = {}) {
  const { url, key } = service ? supabaseServiceConfig() : supabaseConfig();
  const auth = token || key;
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extra,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res;
}

/**
 * @param {string} id
 * @param {{ token?: string }} [opts]
 */
export async function fetchSharedChainRow(id, opts = {}) {
  const { url, key } = supabaseConfig();
  const token = opts.token || key;
  const now = new Date().toISOString();

  async function query(select, withExpiryFilter) {
    let endpoint =
      `${url}/rest/v1/shared_chains` +
      `?id=eq.${encodeURIComponent(id)}` +
      `&select=${select}`;
    if (withExpiryFilter) {
      endpoint += `&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})`;
    }
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    return res;
  }

  let res = await query(
    "id,owner,track_name,target,mode,key_label,bpm,artwork_url,payload,created_at,expires_at",
    true
  );
  if (!res.ok) {
    res = await query(
      "id,owner,track_name,target,mode,key_label,bpm,artwork_url,payload,created_at",
      false
    );
  }
  if (!res.ok) {
    const err = new Error("Upstream share lookup failed.");
    err.status = 502;
    throw err;
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    const err = new Error("Chain not found.");
    err.status = 404;
    throw err;
  }
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    const err = new Error("This share link has expired.");
    err.status = 404;
    throw err;
  }
  return row;
}

export function targetLabel(target) {
  if (target === "instrumental") return "Instrumental chain";
  if (target === "full") return "Full-mix chain";
  return "Vocal chain";
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function shareMeta(row) {
  const title = row.track_name || "Shared chain";
  const target = targetLabel(row.target);
  const bits = [target];
  if (row.key_label) bits.push(`Key ${row.key_label}`);
  if (Number.isFinite(Number(row.bpm))) bits.push(`${Math.round(Number(row.bpm))} BPM`);
  const honesty = row.payload?.honesty || row.payload?.estimateNote;
  const description = honesty
    ? String(honesty).slice(0, 180)
    : `${bits.join(" · ")} — reverse-engineered with Chainprint.`;
  return {
    pageTitle: `${title} — chain | Chainprint`,
    ogTitle: `${title} · Chainprint`,
    ogDescription: description,
    chipLine: bits.join(" · "),
  };
}

export async function getUserFromJwt(token) {
  if (!token) return null;
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function bearerFromEvent(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
