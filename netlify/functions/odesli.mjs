/**
 * Server-side Spotify / streaming identity + preview URL.
 * Browser can't call api.song.link from Netlify (CORS), and Spotify oEmbed
 * is title-only — so we resolve artist (and Spotify's ~30s preview) here.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse Spotify HTML og tags: description is usually "Artist · Album · Song · Year" */
function identityFromSpotifyHtml(html) {
  const title =
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1] ||
    "";
  const description =
    html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:description"/i)?.[1] ||
    "";
  const artwork =
    html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1] ||
    null;

  let artist = "";
  const parts = description.split(/\s*[·•|]\s*/).map(clean).filter(Boolean);
  if (parts.length >= 1 && !/^song$/i.test(parts[0]) && !/^\d{4}$/.test(parts[0])) {
    artist = parts[0];
  }

  // "Title - song and lyrics by Artist | Spotify"
  const by = clean(title).match(/^(.+?)\s+[-–—]\s+song and lyrics by\s+(.+?)(?:\s*\|\s*Spotify)?$/i);
  if (by) {
    return { title: clean(by[1]), artist: clean(by[2]), artwork };
  }

  return {
    title: clean(title),
    artist: clean(artist),
    artwork,
  };
}

/** Spotify's public ~30s MP3 preview when the track has one. */
function previewFromSpotifyHtml(html) {
  const nested = html.match(/"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"(https:\/\/p\.scdn\.co\/mp3-preview\/[^"]+)"/i);
  if (nested?.[1]) return nested[1];
  const loose = html.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[a-zA-Z0-9]+/);
  return loose?.[0] || null;
}

async function fromOdesli(trackUrl, country) {
  const api = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(trackUrl)}&userCountry=${encodeURIComponent(country)}`;
  const res = await fetch(api);
  if (!res.ok) return null;
  const data = await res.json();
  const entities = data.entitiesByUniqueId || {};
  const primary = entities[data.entityUniqueId];
  if (!primary?.title || !primary?.artistName) return null;

  let appleId = null;
  for (const key of ["itunes", "appleMusic"]) {
    const link = data.linksByPlatform?.[key];
    const ent = link?.entityUniqueId ? entities[link.entityUniqueId] : null;
    if (ent?.id) {
      appleId = String(ent.id);
      break;
    }
  }

  return {
    title: clean(primary.title),
    artist: clean(primary.artistName),
    artwork: primary.thumbnailUrl || null,
    appleId,
    source: "odesli",
  };
}

async function fromSpotifyPage(trackUrl) {
  const res = await fetch(trackUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ChainprintBot/1.0; +https://github.com/LAISLAISLAIS/chainprint)",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  const id = identityFromSpotifyHtml(html);
  const previewUrl = previewFromSpotifyHtml(html);
  if (!id.title || !id.artist) {
    return previewUrl ? { title: "", artist: "", artwork: null, appleId: null, previewUrl, source: "spotify_preview" } : null;
  }
  return { ...id, appleId: null, previewUrl, source: "spotify_og" };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  const trackUrl = event.queryStringParameters?.url;
  if (!trackUrl) {
    return json(400, { error: "missing url" });
  }

  const country = event.queryStringParameters?.userCountry || "US";

  try {
    let identity = await fromOdesli(trackUrl, country);
    let previewUrl = null;

    // Always scrape Spotify for preview when we have a track URL — Odesli
    // has identity but never preview audio.
    if (/spotify\.com/i.test(trackUrl)) {
      const spotify = await fromSpotifyPage(trackUrl);
      if (spotify?.previewUrl) previewUrl = spotify.previewUrl;
      if (!identity && spotify?.title && spotify?.artist) {
        identity = spotify;
      } else if (identity && spotify) {
        if (!identity.artwork && spotify.artwork) identity.artwork = spotify.artwork;
      }
    }

    if (!identity) {
      return json(404, { error: "could_not_resolve", url: trackUrl });
    }

    return json(200, { ...identity, previewUrl });
  } catch (err) {
    return json(502, { error: String(err?.message || err) });
  }
}
