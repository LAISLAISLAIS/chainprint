/**
 * Shareable chain pages — persist a chain snapshot to Supabase and read it
 * back on the public /c/ page.
 */

import { authConfig, isSupabaseConfigured } from "../auth/config.js";
import { getSupabase } from "../auth/supabase-client.js";

export function sharingAvailable() {
  return isSupabaseConfigured();
}

/**
 * @param {{ advice: object, trackName?: string, keyLabel?: string, bpm?: number, artworkUrl?: string }} input
 * @returns {Promise<{ id: string, url: string }>}
 */
export async function createSharedChain(input) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Sharing needs the cloud backend — not configured.");

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(userErr.message || "Could not verify your login.");
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Log in to share a chain.");

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

  const row = {
    owner: userId,
    track_name: input.trackName?.slice(0, 160) || null,
    target,
    mode,
    key_label: input.keyLabel?.slice(0, 32) || null,
    bpm: Number.isFinite(Number(input.bpm)) ? Number(input.bpm) : null,
    artwork_url: input.artworkUrl?.slice(0, 500) || null,
    payload: {
      chain: advice.chain,
      honesty: advice.honesty || null,
      estimateNote: advice.estimateNote || null,
      instruments,
    },
  };

  const { data, error } = await supabase
    .from("shared_chains")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    const msg = String(error.message || "");
    if (/shared_chains|PGRST205|schema cache/i.test(msg) || error.code === "PGRST205") {
      throw new Error(
        "Share links need the shared_chains table. In Supabase → SQL, run supabase/migrations/004_shared_chains.sql, then try again."
      );
    }
    if (/row-level security|RLS|permission denied|42501/i.test(msg)) {
      throw new Error("Could not save the share (login expired?). Sign out, sign back in, and retry.");
    }
    throw new Error(msg || "Could not create the share link.");
  }

  return { id: data.id, url: shareUrl(data.id) };
}

export function shareUrl(id) {
  return `${location.origin}/c/?id=${encodeURIComponent(id)}`;
}

/**
 * Public read via REST — no supabase-js needed on the share page.
 * @param {string} id
 */
export async function fetchSharedChain(id) {
  if (!isSupabaseConfigured()) throw new Error("Sharing backend not configured.");
  const uuid = String(id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error("That share link looks malformed.");

  const url =
    `${authConfig.supabaseUrl}/rest/v1/shared_chains` +
    `?id=eq.${encodeURIComponent(uuid)}` +
    `&select=track_name,target,mode,key_label,bpm,artwork_url,payload,created_at`;
  const res = await fetch(url, {
    headers: {
      apikey: authConfig.supabaseAnonKey,
      Authorization: `Bearer ${authConfig.supabaseAnonKey}`,
    },
  });
  if (!res.ok) throw new Error("Could not load that chain.");
  const rows = await res.json();
  if (!rows.length) throw new Error("This chain link doesn't exist (or was deleted).");
  return rows[0];
}
