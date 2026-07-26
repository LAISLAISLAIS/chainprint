/**
 * Authenticated share CRUD for the studio + settings.
 * POST   /api/shares          — create (Bearer user JWT)
 * GET    /api/shares          — list mine
 * DELETE /api/shares?id=…     — delete mine
 */

import { UUID_RE, supabaseConfig } from "./_shared/supabase.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const DEFAULT_TTL_DAYS = 90;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function bearer(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

async function getUserId(token) {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id || null;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const token = bearer(event);
  if (!token) return json(401, { error: "Log in to manage share links." });

  const userId = await getUserId(token);
  if (!userId) return json(401, { error: "Session expired — sign in again." });

  const { url, key } = supabaseConfig();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  try {
    if (event.httpMethod === "GET") {
      let endpoint =
        `${url}/rest/v1/shared_chains` +
        `?owner=eq.${encodeURIComponent(userId)}` +
        `&select=id,track_name,target,mode,key_label,bpm,created_at,expires_at` +
        `&order=created_at.desc` +
        `&limit=50`;
      let res = await fetch(endpoint, { headers });
      if (!res.ok) {
        endpoint =
          `${url}/rest/v1/shared_chains` +
          `?owner=eq.${encodeURIComponent(userId)}` +
          `&select=id,track_name,target,mode,key_label,bpm,created_at` +
          `&order=created_at.desc` +
          `&limit=50`;
        res = await fetch(endpoint, { headers });
      }
      if (!res.ok) return json(502, { error: "Could not list shares." });
      const rows = await res.json();
      return json(200, { shares: Array.isArray(rows) ? rows : [] });
    }

    if (event.httpMethod === "DELETE") {
      const id = String(event.queryStringParameters?.id || "").trim();
      if (!UUID_RE.test(id)) return json(400, { error: "Malformed share id." });
      const endpoint =
        `${url}/rest/v1/shared_chains` +
        `?id=eq.${encodeURIComponent(id)}` +
        `&owner=eq.${encodeURIComponent(userId)}`;
      const res = await fetch(endpoint, { method: "DELETE", headers });
      if (!res.ok) return json(502, { error: "Could not delete that share." });
      return json(200, { ok: true, id });
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON body." });
      }
      if (!body?.payload?.chain) {
        return json(400, { error: "Nothing to share — missing chain payload." });
      }

      const targetRaw = String(body.target || "vocal").toLowerCase();
      const target = ["vocal", "instrumental", "full"].includes(targetRaw) ? targetRaw : "vocal";
      const mode = body.mode === "deep" ? "deep" : "standard";
      const ttlDays = Math.min(365, Math.max(1, Number(body.ttlDays) || DEFAULT_TTL_DAYS));
      const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();

      const row = {
        owner: userId,
        track_name: body.trackName ? String(body.trackName).slice(0, 160) : null,
        target,
        mode,
        key_label: body.keyLabel ? String(body.keyLabel).slice(0, 32) : null,
        bpm: Number.isFinite(Number(body.bpm)) ? Number(body.bpm) : null,
        artwork_url: body.artworkUrl ? String(body.artworkUrl).slice(0, 500) : null,
        payload: body.payload,
        expires_at: expiresAt,
      };

      const res = await fetch(`${url}/rest/v1/shared_chains`, {
        method: "POST",
        headers,
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text();
        if (/expires_at|PGRST204/i.test(text)) {
          // Migration 005 not applied yet — retry without expiry
          delete row.expires_at;
          const retry = await fetch(`${url}/rest/v1/shared_chains`, {
            method: "POST",
            headers,
            body: JSON.stringify(row),
          });
          if (!retry.ok) {
            return json(502, { error: "Could not create share. Run migration 005 if this persists." });
          }
          const created = await retry.json();
          const id = Array.isArray(created) ? created[0]?.id : created?.id;
          return json(201, { id, expires_at: null });
        }
        if (/shared_chains|PGRST205/i.test(text)) {
          return json(503, {
            error: "Share tables missing — run supabase/migrations/004_shared_chains.sql",
          });
        }
        return json(502, { error: "Could not create the share link." });
      }
      const created = await res.json();
      const id = Array.isArray(created) ? created[0]?.id : created?.id;
      if (!id) return json(502, { error: "Share created but id missing." });
      return json(201, { id, expires_at: expiresAt });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return json(500, { error: err?.message || "Share API error." });
  }
}
