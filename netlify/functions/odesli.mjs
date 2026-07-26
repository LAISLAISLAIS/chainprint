/**
 * Server-side Spotify / streaming identity.
 * Browser can't call api.song.link from Netlify (CORS), and Spotify oEmbed
 * is title-only — so we resolve artist here.
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
  if (!id.title || !id.artist) return null;
  return { ...id, appleId: null, source: "spotify_og" };
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
    const odesli = await fromOdesli(trackUrl, country);
    if (odesli) return json(200, odesli);

    if (/spotify\.com/i.test(trackUrl)) {
      const spotify = await fromSpotifyPage(trackUrl);
      if (spotify) return json(200, spotify);
    }

    return json(404, { error: "could_not_resolve", url: trackUrl });
  } catch (err) {
    return json(502, { error: String(err?.message || err) });
  }
}
