/**
 * Shareable chain pages — create / list / delete via /api/shares,
 * public read via Supabase REST or /api/chain/:id.
 */

import { authConfig, isSupabaseConfigured } from "../auth/config.js";
import { getSupabase } from "../auth/supabase-client.js";

const DEFAULT_TTL_DAYS = 90;

export function sharingAvailable() {
  return isSupabaseConfigured();
}

export function shareUrl(id) {
  const origin = typeof location !== "undefined" ? location.origin : "https://chainprint.app";
  return `${origin}/c/${encodeURIComponent(id)}`;
}

async function accessToken() {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

/**
 * @param {{ advice: object, trackName?: string, keyLabel?: string, bpm?: number, artworkUrl?: string, ttlDays?: number }} input
 * @returns {Promise<{ id: string, url: string, expires_at?: string|null }>}
 */
export async function createSharedChain(input) {
  const token = await accessToken();
  if (!token) throw new Error("Log in to share a chain.");

  const advice = input.advice;
  if (!advice?.chain) throw new Error("Nothing to share yet — run an analysis first.");

  const targetRaw = String(advice.target || input.target || "vocal").toLowerCase();
  const target = ["vocal", "instrumental", "full"].includes(targetRaw) ? targetRaw : "vocal";
  const mode = advice.mode === "deep" ? "deep" : "standard";

  const instruments = (Array.isArray(advice.instruments) ? advice.instruments : [])
    .slice(0, 6)
    .map((i) => ({
      label: typeof i === "string" ? i : String(i?.label || i?.name || "Source"),
    }));

  const body = {
    trackName: input.trackName,
    target,
    mode,
    keyLabel: input.keyLabel,
    bpm: input.bpm,
    artworkUrl: input.artworkUrl,
    ttlDays: input.ttlDays ?? DEFAULT_TTL_DAYS,
    payload: {
      chain: advice.chain,
      honesty: advice.honesty || null,
      estimateNote: advice.estimateNote || null,
      instruments,
    },
  };

  const res = await fetch("/api/shares", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (res?.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.id) {
      return { id: data.id, url: shareUrl(data.id), expires_at: data.expires_at ?? null };
    }
  }

  if (res && !res.ok) {
    const data = await res.json().catch(() => ({}));
    // Fall through to direct insert only when the function isn't deployed yet
    if (res.status !== 404 && res.status !== 502) {
      throw new Error(data.error || "Could not create the share link.");
    }
  }

  // Fallback: direct Supabase insert (local / pre-deploy)
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Sharing needs the cloud backend — not configured.");
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Log in to share a chain.");

  const expiresAt = new Date(Date.now() + (body.ttlDays || DEFAULT_TTL_DAYS) * 86400000).toISOString();
  const row = {
    owner: userId,
    track_name: body.trackName?.slice?.(0, 160) || body.trackName || null,
    target: body.target,
    mode: body.mode,
    key_label: body.keyLabel || null,
    bpm: Number.isFinite(Number(body.bpm)) ? Number(body.bpm) : null,
    artwork_url: body.artworkUrl || null,
    payload: body.payload,
    expires_at: expiresAt,
  };

  let insert = await supabase.from("shared_chains").insert(row).select("id").single();
  if (insert.error && /expires_at/i.test(insert.error.message || "")) {
    delete row.expires_at;
    insert = await supabase.from("shared_chains").insert(row).select("id").single();
  }
  if (insert.error) {
    const msg = String(insert.error.message || "");
    if (/shared_chains|PGRST205|schema cache/i.test(msg)) {
      throw new Error(
        "Share links need the shared_chains table. In Supabase → SQL, run supabase/migrations/004_shared_chains.sql (and 005 for expiry)."
      );
    }
    throw new Error(msg || "Could not create the share link.");
  }
  return {
    id: insert.data.id,
    url: shareUrl(insert.data.id),
    expires_at: row.expires_at || null,
  };
}

/**
 * @returns {Promise<Array<object>>}
 */
export async function listMySharedChains() {
  const token = await accessToken();
  if (!token) throw new Error("Log in to manage shares.");
  const res = await fetch("/api/shares", {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (res?.ok) {
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.shares) ? data.shares : [];
  }
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Could not list shares.");
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Log in to manage shares.");
  let q = await supabase
    .from("shared_chains")
    .select("id,track_name,target,mode,key_label,bpm,created_at,expires_at")
    .eq("owner", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (q.error && /expires_at/i.test(q.error.message || "")) {
    q = await supabase
      .from("shared_chains")
      .select("id,track_name,target,mode,key_label,bpm,created_at")
      .eq("owner", userId)
      .order("created_at", { ascending: false })
      .limit(50);
  }
  if (q.error) throw new Error(q.error.message || "Could not list shares.");
  return q.data || [];
}

/**
 * @param {string} id
 */
export async function deleteSharedChain(id) {
  const token = await accessToken();
  if (!token) throw new Error("Log in to manage shares.");
  const res = await fetch(`/api/shares?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (res?.ok) return true;
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Could not delete that share.");
  const { error } = await supabase.from("shared_chains").delete().eq("id", id);
  if (error) throw new Error(error.message || "Could not delete that share.");
  return true;
}

/**
 * Public read — prefers /api/chain, falls back to Supabase REST.
 * @param {string} id
 */
export async function fetchSharedChain(id) {
  const uuid = String(id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error("That share link looks malformed.");

  try {
    const res = await fetch(`/api/chain/${encodeURIComponent(uuid)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const row = await res.json();
      if (row?.payload?.chain) return row;
    }
    if (res.status === 404) throw new Error("This chain link doesn't exist (or was deleted).");
  } catch (err) {
    if (err.message?.includes("doesn't exist")) throw err;
  }

  if (!isSupabaseConfigured()) throw new Error("Sharing backend not configured.");

  const url =
    `${authConfig.supabaseUrl}/rest/v1/shared_chains` +
    `?id=eq.${encodeURIComponent(uuid)}` +
    `&select=id,track_name,target,mode,key_label,bpm,artwork_url,payload,created_at,expires_at`;
  const res = await fetch(url, {
    headers: {
      apikey: authConfig.supabaseAnonKey,
      Authorization: `Bearer ${authConfig.supabaseAnonKey}`,
    },
  });
  if (!res.ok) throw new Error("Could not load that chain.");
  const rows = await res.json();
  if (!rows.length) throw new Error("This chain link doesn't exist (or was deleted).");
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error("This share link has expired.");
  }
  return row;
}

/** Resolve share id from /c/:id or /c/?id= */
export function shareIdFromLocation(loc = location) {
  const params = new URLSearchParams(loc.search);
  if (params.get("id")) return params.get("id");
  const parts = loc.pathname.split("/").filter(Boolean);
  const cIdx = parts.indexOf("c");
  if (cIdx >= 0 && parts[cIdx + 1] && /^[0-9a-f-]{36}$/i.test(parts[cIdx + 1])) {
    return parts[cIdx + 1];
  }
  return "";
}
