/**
 * Optional playlist for the floating / mobile player.
 * Analyze registers playable library tracks; Find usually has 0–1.
 */

/** @typedef {{ id: string, title: string, file: File | Blob }} PlaybackTrack */

/** @type {() => PlaybackTrack[]} */
let provider = () => [];

/** @type {Set<() => void>} */
const listeners = new Set();

/** @param {() => PlaybackTrack[]} fn */
export function setPlaybackTrackProvider(fn) {
  provider = typeof fn === "function" ? fn : () => [];
  notifyPlaylist();
}

export function getPlaybackTracks() {
  try {
    const list = provider();
    return Array.isArray(list) ? list.filter((t) => t && t.id && t.file) : [];
  } catch {
    return [];
  }
}

export function subscribePlaylist(fn) {
  listeners.add(fn);
  fn(getPlaybackTracks());
  return () => listeners.delete(fn);
}

export function notifyPlaylist() {
  const tracks = getPlaybackTracks();
  listeners.forEach((fn) => fn(tracks));
}

/** @type {((id: string) => void) | null} */
let selectHandler = null;

/** Optional: studio selects the matching library entry when a queue track is chosen. */
export function setPlaybackTrackSelectHandler(fn) {
  selectHandler = typeof fn === "function" ? fn : null;
}

export function requestPlaybackTrackSelect(id) {
  if (!id || !selectHandler) return;
  try {
    selectHandler(id);
  } catch {
    /* ignore */
  }
}
