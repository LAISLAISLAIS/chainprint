/**
 * Resolve a reference URL into audio the browser can measure.
 *
 * - Direct .mp3/.wav: fetch file
 * - Spotify / Apple Music / YouTube / SoundCloud: identify the track, then use a
 *   legal clip (Spotify CDN → iTunes → Deezer → SoundCloud ~30–45s Range).
 *   DRM full streams cannot be decoded from those page links in-browser.
 *
 * Never scrapes or rips full masters. Upload remains the accurate path.
 */

const AUDIO_EXT = /\.(wav|wave|mp3|mpeg|ogg|oga|flac|aiff|aif|m4a|aac|opus)(\?|#|$)/i;

/**
 * @typedef {{ platform: string, id?: string, href: string }} ParsedLink
 * @typedef {{
 *   file: File,
 *   meta: {
 *     platform: string,
 *     title: string,
 *     artist: string,
 *     query: string,
 *     preview: boolean,
 *     previewSource: string | null,
 *     matchedTitle?: string,
 *     matchedArtist?: string,
 *     artwork?: string | null,
 *     originalUrl: string,
 *     note: string,
 *   }
 * }} ResolvedReference
 */

export function parseStreamingLink(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname;

  if (host === "open.spotify.com" || host === "spotify.com" || host.endsWith(".spotify.com")) {
    const m = path.match(/\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
    if (m?.[1] === "track") {
      return { platform: "spotify", id: m[2], href: url.href };
    }
    if (m) {
      return {
        platform: "spotify",
        id: m[2],
        href: url.href,
        unsupported: m[1],
        message: `Spotify ${m[1]} links aren’t supported yet — paste a single track link.`,
      };
    }
  }

  if (host === "music.apple.com" || host === "itunes.apple.com") {
    const songParam = url.searchParams.get("i");
    const songPath = path.match(/\/song\/[^/]+\/(\d+)/);
    const albumSong = path.match(/\/album\/[^/]+\/(\d+)/);
    const id = songParam || songPath?.[1] || null;
    return {
      platform: "apple",
      id,
      albumId: albumSong?.[1] || null,
      href: url.href,
    };
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be"
  ) {
    let id = url.searchParams.get("v");
    if (host === "youtu.be") id = path.split("/").filter(Boolean)[0] || id;
    const shorts = path.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shorts) id = shorts[1];
    if (id) return { platform: "youtube", id, href: url.href };
  }

  if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
    const parts = path.split("/").filter(Boolean);
    // soundcloud.com/{user}/{track-slug} — not sets/likes/etc.
    if (parts.length >= 2 && !["you", "discover", "search", "charts", "pages"].includes(parts[0])) {
      return { platform: "soundcloud", id: parts.slice(0, 2).join("/"), href: url.href };
    }
    return {
      platform: "soundcloud",
      href: url.href,
      unsupported: "page",
      message: "Paste a SoundCloud track link (artist/track), not a search or profile page.",
    };
  }

  return null;
}

export function classifyReferenceUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid", message: "That doesn’t look like a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "protocol", message: "Use an http(s) link." };
  }

  const streaming = parseStreamingLink(raw);
  if (streaming?.unsupported) {
    return { ok: false, reason: "unsupported", message: streaming.message };
  }
  if (streaming) {
    return { ok: true, kind: "streaming", streaming, url: url.href };
  }

  return {
    ok: true,
    kind: "direct",
    url: url.href,
    looksLikeAudio: AUDIO_EXT.test(url.pathname) || AUDIO_EXT.test(url.href),
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  return res.json();
}

/** Spotify / YouTube public oEmbed — title + artist-ish metadata only. */
async function oEmbed(platform, href) {
  const endpoints = {
    spotify: `https://open.spotify.com/oembed?url=${encodeURIComponent(href)}`,
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(href)}&format=json`,
  };
  const endpoint = endpoints[platform];
  if (!endpoint) return null;

  const res = await fetch(endpoint, { mode: "cors", credentials: "omit" });
  if (!res.ok) {
    const err = new Error(
      platform === "spotify"
        ? "Spotify didn’t return metadata for that link (some tracks are blocked from embeds)."
        : `Couldn’t read that ${platform} link (${res.status}).`
    );
    err.code = "oembed";
    throw err;
  }
  const data = await res.json();
  return {
    title: cleanText(data.title || ""),
    // Spotify oEmbed intentionally omits author_name — title only
    artist: cleanText(data.author_name || ""),
    artwork: data.thumbnail_url || null,
  };
}

function isLocalHost() {
  if (typeof location === "undefined") return true;
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * Odesli / Spotify identity endpoints.
 * Production: same-origin /api/odesli → Netlify function (identity + Spotify preview).
 * Localhost: try Netlify CLI path, then direct song.link (CORS allows localhost).
 */
function odesliRequestUrls(href) {
  const q = `url=${encodeURIComponent(href)}&userCountry=US`;
  const urls = [];
  if (typeof location !== "undefined") {
    if (!isLocalHost()) {
      urls.push(`${location.origin}/api/odesli?${q}`);
    } else {
      urls.push(`${location.origin}/.netlify/functions/odesli?${q}`);
      urls.push(`${location.origin}/api/odesli?${q}`);
    }
  }
  urls.push(`https://api.song.link/v1-alpha.1/links?${q}`);
  return urls;
}

function parseIdentityPayload(data) {
  // Netlify function shape: { title, artist, artwork, appleId, previewUrl? }
  if (data?.title && data?.artist && !data.entitiesByUniqueId) {
    return {
      title: cleanText(data.title),
      artist: cleanText(data.artist),
      artwork: data.artwork || null,
      appleId: data.appleId ? String(data.appleId) : null,
      previewUrl: data.previewUrl || null,
    };
  }

  // Raw Odesli / song.link shape
  const entities = data?.entitiesByUniqueId || {};
  const primary = entities[data?.entityUniqueId];
  if (!primary?.title) return null;

  let appleId = null;
  for (const key of ["itunes", "appleMusic"]) {
    const link = data.linksByPlatform?.[key];
    const ent = link?.entityUniqueId ? entities[link.entityUniqueId] : null;
    if (ent?.id) {
      appleId = String(ent.id);
      break;
    }
  }
  if (!appleId) {
    for (const [eid, ent] of Object.entries(entities)) {
      if (/^(ITUNES|APPLE_MUSIC)_SONG::/i.test(eid) && ent?.id) {
        appleId = String(ent.id);
        break;
      }
    }
  }

  const artist = cleanText(primary.artistName || "");
  if (!artist) return null;

  return {
    title: cleanText(primary.title),
    artist,
    artwork: primary.thumbnailUrl || null,
    appleId,
    previewUrl: null,
  };
}

/**
 * Cross-service identity. Spotify oEmbed has no artist.
 */
async function songLinkIdentity(href) {
  for (const url of odesliRequestUrls(href)) {
    try {
      const data = await fetchJson(url);
      const parsed = parseIdentityPayload(data);
      if (parsed?.title && parsed?.artist) return parsed;
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}

function cleanText(s) {
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/\s*[|\-–—]\s*YouTube$/i, "")
    .trim();
}

/**
 * Turn messy oEmbed titles into { title, artist } for iTunes search.
 */
export function normalizeTrackQuery(meta, platform) {
  let title = meta.title || "";
  let artist = meta.artist || "";

  if (platform === "youtube") {
    // "Artist - Topic" channels
    if (/ - Topic$/i.test(artist)) {
      artist = artist.replace(/\s*- Topic$/i, "").trim();
    }
    // "Song Title (Official Video)" / "Artist - Song"
    title = title
      .replace(/\((official|lyrics?|audio|video|visualizer|hd|4k)[^)]*\)/gi, "")
      .replace(/\[(official|lyrics?|audio|video)[^\]]*\]/gi, "")
      .trim();
    const dash = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dash && !meta._split) {
      // Prefer "Artist - Title" when channel isn't the artist
      if (/vevo|records|music|official/i.test(artist) || artist.length > 40) {
        artist = dash[1].trim();
        title = dash[2].trim();
      }
    }
  }

  if (platform === "spotify") {
    // Prefer "Track - song and lyrics by Artist" if a page title ever leaks in
    const by = title.match(/^(.+?)\s+[-–—]\s+song and lyrics by\s+(.+?)(?:\s*\|\s*Spotify)?$/i);
    if (by) {
      title = by[1].trim();
      if (!artist) artist = by[2].trim();
    }
    // "Artist · Track" rare forms
    const dot = title.match(/^(.+?)\s*[·•]\s*(.+)$/);
    if (dot && !artist) {
      // og:description style is artist · album — title is usually track-only
    }
  }

  const query = [title, artist].filter(Boolean).join(" ").trim() || title;
  return { title, artist, query };
}

async function itunesLookupById(id) {
  const data = await fetchJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`);
  const track = (data.results || []).find((r) => r.wrapperType === "track" || r.kind === "song");
  return track || null;
}

async function itunesSearch(term) {
  const data = await fetchJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=25`
  );
  return data.results || [];
}

function stripEditionTags(title) {
  return cleanText(title)
    .replace(
      /\s*[-–—(]\s*(remaster(ed)?(\s+version)?|deluxe|bonus|live|mono|stereo|radio edit|extended|version)[^)]*\)?/gi,
      ""
    )
    .replace(/\s*[-–—]\s*\d{4}.*$/i, "")
    .trim();
}

/** Normalize artist strings for comparison (feat. / & / commas). */
function normalizeArtist(name) {
  return cleanText(name)
    .toLowerCase()
    .replace(/\s*(feat\.?|ft\.?|featuring|with)\s+.*/i, "")
    .replace(/\s*[&+,/]\s*.*/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function artistsCompatible(have, want) {
  if (!want) return true;
  const a = normalizeArtist(have);
  const b = normalizeArtist(want);
  if (!a || !b) return false;
  if (a === b) return true;
  // "The Weeknd" vs "Weeknd", or multi-artist lines still containing the primary
  if (a.includes(b) || b.includes(a)) return true;
  const haveFull = cleanText(have).toLowerCase();
  const wantFull = cleanText(want).toLowerCase();
  return haveFull.includes(wantFull) || wantFull.includes(haveFull);
}

function scoreMatch(track, title, artist) {
  const t = (track.trackName || "").toLowerCase();
  const a = track.artistName || "";
  const wantT = stripEditionTags(title).toLowerCase();
  const wantA = (artist || "").trim();
  let score = 0;

  if (!wantT) return -1;
  if (t === wantT) score += 8;
  else if (t.startsWith(wantT) || wantT.startsWith(t)) score += 5;
  else if (t.includes(wantT) || wantT.includes(t)) {
    // Avoid weak substring traps ("Time" inside "Remastered Version" queries, etc.)
    if (Math.min(t.length, wantT.length) < 4) return -1;
    score += 2;
  } else {
    return -1;
  }

  if (wantA) {
    // Never accept same-title / wrong-artist (covers, karaoke, tribute acts)
    if (!artistsCompatible(a, wantA)) return -1;
    if (normalizeArtist(a) === normalizeArtist(wantA)) score += 8;
    else score += 4;
  } else {
    // Title-only search is unreliable for common names — keep scores low
    score -= 4;
  }

  if (track.previewUrl) score += 1;
  return score;
}

async function findItunesPreview({ title, artist, query, appleId }) {
  if (appleId) {
    const direct = await itunesLookupById(appleId);
    if (direct?.previewUrl) {
      // Still verify artist when we know it — wrong Apple id would be rare but cheap to check
      if (!artist || artistsCompatible(direct.artistName || "", artist)) return direct;
    }
  }

  const cleanTitle = stripEditionTags(title);
  // Prefer "title + artist" so iTunes ranks the right recording first
  const searchTerm =
    [cleanTitle, artist].filter(Boolean).join(" ").trim() || stripEditionTags(query);
  let results = await itunesSearch(searchTerm);
  if (!results.length && artist && cleanTitle) {
    // Retry title-only, then filter by artist — still rejects mismatches in scoreMatch
    results = await itunesSearch(cleanTitle);
  }
  if (!results.length) return null;

  const ranked = results
    .map((r) => ({ r, score: scoreMatch(r, cleanTitle || title, artist) }))
    .filter((x) => x.score >= (artist ? 8 : 10))
    .sort((x, y) => y.score - x.score);

  return ranked[0]?.r || null;
}

/**
 * Deezer search (CORS-open). Returns iTunes-like shape when a preview exists.
 */
async function findDeezerPreview({ title, artist }) {
  const cleanTitle = stripEditionTags(title);
  const q = [artist, cleanTitle].filter(Boolean).join(" ").trim();
  if (!q) return null;

  let data;
  try {
    data = await fetchJson(
      `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=12`
    );
  } catch {
    return null;
  }

  const tracks = Array.isArray(data?.data) ? data.data : [];
  const ranked = tracks
    .map((t) => {
      const fake = {
        trackName: t.title || "",
        artistName: t.artist?.name || "",
        previewUrl: t.preview || null,
        artworkUrl100: t.album?.cover_medium || t.album?.cover || null,
      };
      return { r: fake, score: scoreMatch(fake, cleanTitle || title, artist) };
    })
    .filter((x) => x.r.previewUrl && x.score >= (artist ? 8 : 10))
    .sort((x, y) => y.score - x.score);

  return ranked[0]?.r || null;
}

function soundcloudRequestUrls({ title, artist, query, url }) {
  const params = new URLSearchParams();
  if (url) params.set("url", url);
  if (title) params.set("title", title);
  if (artist) params.set("artist", artist);
  if (query && !title) params.set("q", query);
  else if (title || artist) params.set("q", [artist, title].filter(Boolean).join(" "));
  const q = params.toString();
  const urls = [];
  if (typeof location !== "undefined") {
    if (!isLocalHost()) {
      urls.push(`${location.origin}/api/soundcloud?${q}`);
    } else {
      urls.push(`${location.origin}/.netlify/functions/soundcloud?${q}`);
      urls.push(`${location.origin}/api/soundcloud?${q}`);
    }
  }
  return urls;
}

/**
 * SoundCloud via Netlify function (api-v2 has no browser CORS).
 */
async function findSoundCloudPreview({ title, artist, query, url }) {
  for (const endpoint of soundcloudRequestUrls({ title, artist, query, url })) {
    try {
      const data = await fetchJson(endpoint);
      if (data?.previewUrl) {
        return {
          trackName: data.title || title,
          artistName: data.artist || artist,
          previewUrl: data.previewUrl,
          artworkUrl100: data.artwork || null,
          source: "soundcloud",
          durationMs: data.durationMs || null,
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function findPreviewClip({ title, artist, query, appleId, spotifyPreviewUrl }) {
  if (spotifyPreviewUrl) {
    return {
      previewUrl: spotifyPreviewUrl,
      trackName: title,
      artistName: artist,
      artworkUrl100: null,
      source: "spotify",
    };
  }

  const itunes = await findItunesPreview({ title, artist, query, appleId });
  if (itunes?.previewUrl) {
    return { ...itunes, source: "itunes" };
  }

  const deezer = await findDeezerPreview({ title, artist });
  if (deezer?.previewUrl) {
    return { ...deezer, source: "deezer" };
  }

  const soundcloud = await findSoundCloudPreview({ title, artist, query });
  if (soundcloud?.previewUrl) {
    return soundcloud;
  }

  return null;
}

/** ~45s at 128 kbps — keep SoundCloud clips short for analysis. */
const SOUNDCLOUD_CLIP_BYTES = 720000;

async function fileFromPreviewUrl(previewUrl, filename, opts = {}) {
  const headers = {};
  if (opts.maxBytes) headers.Range = `bytes=0-${opts.maxBytes - 1}`;
  const res = await fetch(previewUrl, { mode: "cors", credentials: "omit", headers });
  if (!res.ok && res.status !== 206) throw new Error(`Preview fetch failed (${res.status})`);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "audio/mpeg" });
}

function previewNote(source, platform, matchedArtist, matchedTitle) {
  if (source === "spotify") {
    return `Identified from ${platform} · measuring Spotify’s ~30s preview. Upload the full file for a better readout.`;
  }
  if (source === "deezer") {
    return `Identified from ${platform} · measuring Deezer’s ~30s preview match (“${matchedArtist} — ${matchedTitle}”). Upload the full file for a better readout.`;
  }
  if (source === "soundcloud") {
    return `Identified from ${platform} · measuring a short SoundCloud clip (“${matchedArtist} — ${matchedTitle}”). Upload the full file you own for a better readout.`;
  }
  return `Identified from ${platform} · measuring Apple’s official ~30s preview match (“${matchedArtist} — ${matchedTitle}”). Upload the full file for a better readout.`;
}

async function resolveStreaming(streaming, manualQuery = null) {
  if (streaming.unsupported) {
    const err = new Error(streaming.message);
    err.code = "unsupported";
    throw err;
  }

  let title = "";
  let artist = "";
  let artwork = null;
  let appleId = streaming.platform === "apple" ? streaming.id : null;
  let spotifyPreviewUrl = null;

  if (manualQuery) {
    const parts = manualQuery.split(/[-–—]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      artist = parts[0];
      title = parts.slice(1).join(" - ");
    } else {
      title = manualQuery.trim();
    }
  } else if (streaming.platform === "apple" && appleId) {
    const track = await itunesLookupById(appleId);
    if (track) {
      title = track.trackName || "";
      artist = track.artistName || "";
      artwork = track.artworkUrl100 || null;
      if (track.previewUrl) {
        const file = await fileFromPreviewUrl(
          track.previewUrl,
          `${artist} - ${title} (preview).m4a`.replace(/[\\/:*?"<>|]/g, "")
        );
        file._chainprintOrigin = "preview";
        return {
          file,
          meta: {
            platform: "apple",
            title,
            artist,
            query: `${title} ${artist}`,
            preview: true,
            previewSource: "itunes",
            matchedTitle: title,
            matchedArtist: artist,
            artwork,
            originalUrl: streaming.href,
            note: "Using Apple’s official ~30s preview. Upload the full file you own for a stronger readout.",
          },
        };
      }
    }
  } else if (streaming.platform === "spotify") {
    // oEmbed is title-only — resolve real artist (+ preview) via /api/odesli
    const linked = await songLinkIdentity(streaming.href);
    if (linked?.title && linked?.artist) {
      title = linked.title;
      artist = linked.artist;
      artwork = linked.artwork;
      if (linked.appleId) appleId = linked.appleId;
      if (linked.previewUrl) spotifyPreviewUrl = linked.previewUrl;
    } else {
      try {
        const emb = await oEmbed("spotify", streaming.href);
        title = emb.title;
        artist = emb.artist;
        artwork = emb.artwork;
      } catch (e) {
        const err = new Error(
          `${e.message} Type the artist and song below (e.g. The Weeknd – Blinding Lights), or upload the file.`
        );
        err.code = "needs_identity";
        err.meta = {
          platform: "spotify",
          title: "",
          artist: "",
          artwork: null,
          originalUrl: streaming.href,
        };
        throw err;
      }
    }
    if (!artist) {
      const err = new Error(
        `Got the song title${title ? ` (“${title}”)` : ""}, but not the artist. Type Artist – Song below so we don’t match a cover, or upload the file.`
      );
      err.code = "needs_identity";
      err.meta = {
        platform: "spotify",
        title,
        artist: "",
        artwork,
        originalUrl: streaming.href,
      };
      throw err;
    }
  } else if (streaming.platform === "youtube") {
    try {
      const emb = await oEmbed(streaming.platform, streaming.href);
      title = emb.title;
      artist = emb.artist;
      artwork = emb.artwork;
    } catch (e) {
      const err = new Error(
        `${e.message} Type the artist and song below (e.g. The Weeknd – Blinding Lights), or upload the file.`
      );
      err.code = "needs_identity";
      err.meta = {
        platform: streaming.platform,
        title: "",
        artist: "",
        artwork: null,
        originalUrl: streaming.href,
      };
      throw err;
    }
  } else if (streaming.platform === "soundcloud" && !manualQuery) {
    const sc = await findSoundCloudPreview({ url: streaming.href });
    if (sc?.previewUrl) {
      const matchedTitle = sc.trackName || "track";
      const matchedArtist = sc.artistName || "";
      const file = await fileFromPreviewUrl(
        sc.previewUrl,
        `${matchedArtist} - ${matchedTitle} (soundcloud).mp3`.replace(/[\\/:*?"<>|]/g, ""),
        { maxBytes: SOUNDCLOUD_CLIP_BYTES }
      );
      file._chainprintOrigin = "preview";
      return {
        file,
        meta: {
          platform: "soundcloud",
          title: matchedTitle,
          artist: matchedArtist,
          query: `${matchedTitle} ${matchedArtist}`,
          preview: true,
          previewSource: "soundcloud",
          matchedTitle,
          matchedArtist,
          artwork: sc.artworkUrl100 || null,
          originalUrl: streaming.href,
          note: previewNote("soundcloud", "soundcloud", matchedArtist, matchedTitle),
        },
      };
    }
    const err = new Error(
      "Couldn’t stream that SoundCloud track (private, geo-blocked, or no progressive audio). Upload the file instead."
    );
    err.code = "no_preview";
    err.meta = { platform: "soundcloud", originalUrl: streaming.href };
    throw err;
  }

  // Apple album link without song id
  if (streaming.platform === "apple" && !appleId && !manualQuery) {
    const err = new Error(
      "Open the specific song in Apple Music (not just the album), copy that link, or upload the file."
    );
    err.code = "need_song";
    throw err;
  }

  const normalized = normalizeTrackQuery({ title, artist }, streaming.platform);
  if (!normalized.query) {
    const err = new Error("Couldn’t identify that track. Type artist – song name, or upload the file.");
    err.code = "needs_identity";
    err.meta = { platform: streaming.platform, originalUrl: streaming.href };
    throw err;
  }

  const match = await findPreviewClip({
    title: normalized.title,
    artist: normalized.artist,
    query: normalized.query,
    appleId,
    spotifyPreviewUrl,
  });

  if (!match?.previewUrl) {
    const err = new Error(
      `No preview clip for “${normalized.title || "track"}”${normalized.artist ? ` by ${normalized.artist}` : ""}. Upload the file (or a short clip) to measure it.`
    );
    err.code = "no_preview";
    err.meta = {
      platform: streaming.platform,
      title: normalized.title,
      artist: normalized.artist,
      artwork,
      originalUrl: streaming.href,
    };
    throw err;
  }

  const matchedTitle = match.trackName || normalized.title;
  const matchedArtist = match.artistName || normalized.artist;
  const source = match.source || "itunes";
  const ext = /\.m4a(\?|$)/i.test(match.previewUrl) ? "m4a" : "mp3";
  const file = await fileFromPreviewUrl(
    match.previewUrl,
    `${matchedArtist} - ${matchedTitle} (preview).${ext}`.replace(/[\\/:*?"<>|]/g, ""),
    source === "soundcloud" ? { maxBytes: SOUNDCLOUD_CLIP_BYTES } : {}
  );
  file._chainprintOrigin = "preview";

  return {
    file,
    meta: {
      platform: streaming.platform,
      title: normalized.title,
      artist: normalized.artist,
      query: normalized.query,
      preview: true,
      previewSource: source,
      matchedTitle,
      matchedArtist,
      artwork: match.artworkUrl100 || artwork,
      originalUrl: streaming.href,
      note: previewNote(source, streaming.platform, matchedArtist, matchedTitle),
    },
  };
}

async function resolveDirect(classified) {
  let res;
  try {
    res = await fetch(classified.url, { mode: "cors", credentials: "omit" });
  } catch {
    const err = new Error(
      "Couldn’t fetch that link (usually CORS). Upload the file instead — audio still stays on your machine."
    );
    err.code = "cors";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Link returned HTTP ${res.status}. Try uploading the file.`);
    err.code = "http";
    throw err;
  }
  const type = res.headers.get("content-type") || "";
  if (type && !type.startsWith("audio/") && !type.includes("octet-stream") && !classified.looksLikeAudio) {
    const err = new Error("That URL doesn’t look like audio. Use a Spotify / Apple / YouTube / SoundCloud track link, a direct .mp3, or upload.");
    err.code = "not_audio";
    throw err;
  }
  const blob = await res.blob();
  const nameGuess =
    decodeURIComponent(classified.url.split("/").pop()?.split("?")[0] || "reference") ||
    "reference.audio";
  const file = new File([blob], nameGuess, { type: blob.type || type || "audio/mpeg" });
  file._chainprintOrigin = "url";
  return {
    file,
    meta: {
      platform: "direct",
      title: nameGuess,
      artist: "",
      query: nameGuess,
      preview: false,
      previewSource: null,
      artwork: null,
      originalUrl: classified.url,
      note: "Direct audio link · full file measured in your browser.",
    },
  };
}

/**
 * Main entry: any supported URL → File + metadata for analysis.
 * @param {string} raw
 * @param {{ manualQuery?: string }} [opts]
 * @returns {Promise<ResolvedReference>}
 */
export async function resolveReferenceUrl(raw, opts = {}) {
  const classified = classifyReferenceUrl(raw);
  if (!classified.ok) {
    const err = new Error(classified.message);
    err.code = classified.reason;
    throw err;
  }
  if (classified.kind === "streaming") {
    return resolveStreaming(classified.streaming, opts.manualQuery || null);
  }
  return resolveDirect(classified);
}

/** @deprecated use resolveReferenceUrl */
export async function fetchAudioUrl(rawUrl) {
  const resolved = await resolveReferenceUrl(rawUrl);
  return resolved.file;
}
