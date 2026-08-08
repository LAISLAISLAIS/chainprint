/**
 * SoundCloud search → progressive MP3 URL for measurement clips.
 * api-v2 is not CORS-open for browsers, so we resolve server-side.
 *
 * Uses the same public client_id the SoundCloud web app embeds (with scrape
 * refresh + fallback). Returns a short-lived CDN URL; the client should
 * Range-fetch ~30–45s only — never treat this as a full-master download.
 */

import { corsHeaders } from "./_shared/cors.mjs";
import { rateLimit, rateLimitHeaders } from "./_shared/rate-limit.mjs";

const FALLBACK_CLIENT_ID = String(process.env.SOUNDCLOUD_CLIENT_ID || "").trim();
const UA =
  "Mozilla/5.0 (compatible; ChainprintBot/1.0; +https://github.com/LAISLAISLAIS/chainprint)";

let cachedClientId = null;
let cachedAt = 0;

function json(statusCode, body, event, extra = {}) {
  const CORS = corsHeaders(event || {}, { allowPublic: true });
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  };
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(s) {
  return clean(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function spamTitle(title) {
  return /\b(slowed|reverb|nightcore|8d|sped up|tiktok|cover by)\b/i.test(title || "");
}

async function discoverClientId() {
  if (cachedClientId && Date.now() - cachedAt < 6 * 60 * 60 * 1000) {
    return cachedClientId;
  }
  try {
    const home = await fetch("https://soundcloud.com", {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    const html = await home.text();
    const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(
      (m) => m[1]
    );
    for (const url of scripts.slice(0, 10)) {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const js = await res.text();
      const matches = [...js.matchAll(/client_id:"([A-Za-z0-9]{20,40})"/g)].map((m) => m[1]);
      const id = matches.find((x) => !x.includes(".") && !/google|apps/i.test(x));
      if (id) {
        cachedClientId = id;
        cachedAt = Date.now();
        return id;
      }
    }
  } catch {
    /* fall through */
  }
  cachedClientId = FALLBACK_CLIENT_ID;
  cachedAt = Date.now();
  return FALLBACK_CLIENT_ID;
}

function scoreTrack(track, wantTitle, wantArtist) {
  const title = clean(track.title || "");
  const artist =
    clean(track.publisher_metadata?.artist) ||
    clean(track.user?.full_name) ||
    clean(track.user?.username) ||
    "";
  const nt = normalize(title);
  const na = normalize(artist);
  const wt = normalize(wantTitle);
  const wa = normalize(wantArtist);

  if (!wt) return -1;
  let score = 0;

  if (nt === wt) score += 12;
  else if (nt.includes(wt) || wt.includes(nt)) score += 8;
  else if (wt.split(" ").filter((w) => w.length > 2 && nt.includes(w)).length >= 1) score += 3;
  else return -1;

  if (wa) {
    if (na === wa) score += 10;
    else if (na.includes(wa) || wa.includes(na)) score += 7;
    else if (wa.split(" ").some((w) => w.length > 2 && na.includes(w))) score += 4;
    else return -1;
  }

  if (spamTitle(title)) score -= 8;
  if (track.policy === "SNIP" || track.access === "preview") score += 1;
  return score;
}

function pickProgressive(track) {
  const trans = track?.media?.transcodings || [];
  const progressive = trans.find(
    (t) => t?.format?.protocol === "progressive" && /mpeg/i.test(t?.format?.mime_type || "")
  );
  return progressive || trans.find((t) => t?.format?.protocol === "progressive") || null;
}

async function resolveStreamUrl(transcodingUrl, clientId) {
  const sep = transcodingUrl.includes("?") ? "&" : "?";
  const url = `${transcodingUrl}${sep}client_id=${encodeURIComponent(clientId)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.url || null;
}

async function searchTracks(q, clientId) {
  const api = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${encodeURIComponent(clientId)}&limit=12&app_locale=en`;
  const res = await fetch(api, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.collection) ? data.collection : [];
}

async function resolveUrl(trackUrl, clientId) {
  const api = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${encodeURIComponent(clientId)}`;
  const res = await fetch(api, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data?.kind !== "track") return null;
  return data;
}

function toPayload(track, previewUrl) {
  const artist =
    clean(track.publisher_metadata?.artist) ||
    clean(track.user?.full_name) ||
    clean(track.user?.username) ||
    "";
  return {
    title: clean(track.title),
    artist,
    previewUrl,
    artwork: track.artwork_url || track.user?.avatar_url || null,
    durationMs: track.full_duration || track.duration || null,
    permalink: track.permalink_url || null,
    source: "soundcloud",
  };
}

async function streamForTrack(track, clientId) {
  const prog = pickProgressive(track);
  if (!prog?.url) return null;
  return resolveStreamUrl(prog.url, clientId);
}

export async function handler(event) {
  const CORS = corsHeaders(event, { allowPublic: true });
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const rl = await rateLimit(event, {
    bucket: "soundcloud",
    limit: 40,
    windowSec: 60,
    requireShared: true,
  });
  if (!rl.ok) {
    return json(rl.statusCode, { error: rl.error }, event, rateLimitHeaders(rl));
  }

  const q = clean(event.queryStringParameters?.q || "");
  const trackUrl = clean(event.queryStringParameters?.url || "");
  const title = clean(event.queryStringParameters?.title || "");
  const artist = clean(event.queryStringParameters?.artist || "");

  if (!q && !trackUrl && !(title || artist)) {
    return json(400, { error: "missing q, url, or title/artist" }, event);
  }

  try {
    const clientId = await discoverClientId();
    if (!clientId) {
      return json(503, { error: "SoundCloud client is not configured." }, event);
    }

    if (trackUrl) {
      const track = await resolveUrl(trackUrl, clientId);
      if (!track) return json(404, { error: "could_not_resolve", url: trackUrl }, event);
      const previewUrl = await streamForTrack(track, clientId);
      if (!previewUrl) return json(404, { error: "no_stream", url: trackUrl }, event);
      return json(200, toPayload(track, previewUrl), event);
    }

    const query = q || [artist, title].filter(Boolean).join(" ");
    const tracks = await searchTracks(query, clientId);
    const wantTitle = title || q;
    const wantArtist = artist;

    const ranked = tracks
      .map((t) => ({ t, score: scoreTrack(t, wantTitle, wantArtist) }))
      .filter((x) => x.score >= (wantArtist ? 10 : 8))
      .sort((a, b) => b.score - a.score);

    for (const { t } of ranked) {
      const previewUrl = await streamForTrack(t, clientId);
      if (previewUrl) return json(200, toPayload(t, previewUrl), event);
    }

    if (wantArtist && !ranked.length) {
      const loose = tracks
        .map((t) => ({ t, score: scoreTrack(t, wantTitle, "") }))
        .filter((x) => x.score >= 8 && !spamTitle(x.t.title))
        .sort((a, b) => b.score - a.score);
      for (const { t } of loose.slice(0, 3)) {
        if (wantArtist) {
          const a =
            clean(t.publisher_metadata?.artist) ||
            clean(t.user?.full_name) ||
            clean(t.user?.username);
          const na = normalize(a);
          const wa = normalize(wantArtist);
          if (!(na.includes(wa) || wa.includes(na))) continue;
        }
        const previewUrl = await streamForTrack(t, clientId);
        if (previewUrl) return json(200, toPayload(t, previewUrl), event);
      }
    }

    return json(404, { error: "no_match", query }, event);
  } catch (err) {
    console.error("[soundcloud]", err);
    return json(502, { error: "Lookup failed." }, event);
  }
}
