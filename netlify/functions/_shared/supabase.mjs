/**
 * Shared Supabase helpers for Netlify functions (anon or user JWT).
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
  ).trim();
  return {
    url: url || "https://wggvvgigtwzwivpgszyr.supabase.co",
    key: key || "sb_publishable_mGJIAlOvSs_5sahA8i0qiQ_q5gskCtM",
  };
}

export function siteOrigin(event) {
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host = event.headers?.["x-forwarded-host"] || event.headers?.host || "chainprint.app";
  return `${proto}://${host}`.replace(/\/$/, "");
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
    // Migration 005 not applied — retry without expires_at
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
