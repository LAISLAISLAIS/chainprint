/**
 * Authenticated share CRUD for the studio + settings.
 * POST   /api/shares          — create (Bearer user JWT)
 * GET    /api/shares          — list mine
 * DELETE /api/shares?id=…     — delete mine
 */

import { corsHeaders, isOriginAllowed } from "./_shared/cors.mjs";
import { jsonError, jsonResponse } from "./_shared/errors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";
import { UUID_RE, bearerFromEvent, getUserFromJwt, supabaseConfig } from "./_shared/supabase.mjs";

const DEFAULT_TTL_DAYS = 90;

export async function handler(event) {
  const cors = corsHeaders(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (!isOriginAllowed(event)) {
    return jsonError(403, "Origin not allowed", null, cors);
  }

  const token = bearerFromEvent(event);
  if (!token) return jsonError(401, "Log in to manage share links.", null, cors);

  const user = await getUserFromJwt(token);
  const userId = user?.id;
  if (!userId) return jsonError(401, "Session expired — sign in again.", null, cors);

  const rl = await rateLimit(event, {
    bucket: "shares",
    limit: event.httpMethod === "POST" ? 20 : 60,
    windowSec: 60,
    userId,
    requireShared: true,
  });
  if (!rl.ok) {
    return jsonError(rl.statusCode, rl.error, null, { ...cors, ...rateLimitHeaders(rl) });
  }

  let url;
  let key;
  try {
    ({ url, key } = supabaseConfig());
  } catch (err) {
    return jsonError(503, "Share API is not configured.", err, cors);
  }

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
      if (!res.ok) return jsonError(502, "Could not list shares.", null, cors);
      const rows = await res.json();
      return jsonResponse(200, { shares: Array.isArray(rows) ? rows : [] }, cors);
    }

    if (event.httpMethod === "DELETE") {
      const id = String(event.queryStringParameters?.id || "").trim();
      if (!UUID_RE.test(id)) return jsonError(400, "Malformed share id.", null, cors);
      const endpoint =
        `${url}/rest/v1/shared_chains` +
        `?id=eq.${encodeURIComponent(id)}` +
        `&owner=eq.${encodeURIComponent(userId)}`;
      const res = await fetch(endpoint, { method: "DELETE", headers });
      if (!res.ok) return jsonError(502, "Could not delete that share.", null, cors);
      return jsonResponse(200, { ok: true, id }, cors);
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return jsonError(400, "Invalid JSON body.", null, cors);
      }
      if (!body?.payload?.chain) {
        return jsonError(400, "Nothing to share — missing chain payload.", null, cors);
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
          delete row.expires_at;
          const retry = await fetch(`${url}/rest/v1/shared_chains`, {
            method: "POST",
            headers,
            body: JSON.stringify(row),
          });
          if (!retry.ok) {
            return jsonError(502, "Could not create share.", null, cors);
          }
          const created = await retry.json();
          const id = Array.isArray(created) ? created[0]?.id : created?.id;
          return jsonResponse(201, { id, expires_at: null }, cors);
        }
        if (/shared_chains|PGRST205/i.test(text)) {
          return jsonError(503, "Share tables missing — run migrations.", null, cors);
        }
        return jsonError(502, "Could not create the share link.", null, cors);
      }
      const created = await res.json();
      const id = Array.isArray(created) ? created[0]?.id : created?.id;
      if (!id) return jsonError(502, "Share created but id missing.", null, cors);
      return jsonResponse(201, { id, expires_at: expiresAt }, cors);
    }

    return jsonError(405, "Method not allowed", null, cors);
  } catch (err) {
    return jsonError(500, "Share API error.", err, cors);
  }
}
