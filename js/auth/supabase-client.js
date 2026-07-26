/**
 * Supabase browser client (loaded only when configured).
 */

import { authConfig, isSupabaseConfigured } from "./config.js";

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let client = null;
/** @type {Promise<import("@supabase/supabase-js").SupabaseClient | null> | null} */
let loading = null;

export async function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  if (loading) return loading;

  loading = (async () => {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.76.1"
    );
    client = createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return client;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}
