/**
 * In-app reference playback — plays the same audio we measured (file or preview).
 */

let audio = null;
/** @type {string | null} */
let objectUrl = null;
/** @type {string | null} */
let currentKey = null;
/** @type {string} */
let currentTitle = "";
let volume = 0.85;
let muted = false;
/** @type {((ev: Event) => void) | null} */
let onEnded = null;
/** @type {((ev: Event) => void) | null} */
let onPause = null;
/** @type {((ev: Event) => void) | null} */
let onPlay = null;
/** @type {((ev: Event) => void) | null} */
let onTime = null;
/** @type {((ev: Event) => void) | null} */
let onMeta = null;
/** @type {Set<(s: ReturnType<typeof snapshot>) => void>} */
const listeners = new Set();

function applyVolume() {
  if (audio) audio.volume = muted ? 0 : volume;
}

function snapshot() {
  const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
  const currentTime = audio ? audio.currentTime || 0 : 0;
  return {
    active: Boolean(audio && currentKey),
    playing: Boolean(audio && !audio.paused),
    key: currentKey,
    title: currentTitle,
    volume,
    muted,
    currentTime,
    duration,
    progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
  };
}

/** @type {number} */
let lastTimeNotify = 0;

function notify() {
  const state = snapshot();
  listeners.forEach((fn) => fn(state));
}

function notifyTime() {
  const now = performance.now();
  if (now - lastTimeNotify < 200) return;
  lastTimeNotify = now;
  notify();
}

function teardown() {
  if (audio) {
    audio.pause();
    if (onEnded) audio.removeEventListener("ended", onEnded);
    if (onPause) audio.removeEventListener("pause", onPause);
    if (onPlay) audio.removeEventListener("play", onPlay);
    if (onTime) audio.removeEventListener("timeupdate", onTime);
    if (onMeta) audio.removeEventListener("loadedmetadata", onMeta);
    audio.removeAttribute("src");
    audio.load();
    audio = null;
  }
  onEnded = onPause = onPlay = onTime = onMeta = null;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  currentKey = null;
  currentTitle = "";
  notify();
}

/**
 * @param {File | Blob | string} source — File/Blob or http(s) URL
 * @param {string} [key] — identity for UI play/pause toggles
 * @param {{ title?: string }} [opts]
 */
export async function playAudio(source, key = "default", opts = {}) {
  const title =
    typeof opts.title === "string" && opts.title.trim()
      ? opts.title.trim()
      : inferTitle(source, key);

  if (currentKey === key && audio && !audio.paused) {
    audio.pause();
    notify();
    return { playing: false, key };
  }

  if (currentKey === key && audio && audio.paused) {
    try {
      currentTitle = title || currentTitle;
      applyVolume();
      await audio.play();
      notify();
      return { playing: true, key };
    } catch {
      teardown();
    }
  }

  teardown();

  audio = new Audio();
  audio.preload = "auto";
  currentKey = key;
  currentTitle = title;
  applyVolume();

  if (typeof source === "string") {
    audio.src = source;
  } else {
    objectUrl = URL.createObjectURL(source);
    audio.src = objectUrl;
  }

  onEnded = () => notify();
  onPause = () => notify();
  onPlay = () => notify();
  onTime = () => notifyTime();
  onMeta = () => notify();
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("play", onPlay);
  audio.addEventListener("timeupdate", onTime);
  audio.addEventListener("loadedmetadata", onMeta);

  try {
    await audio.play();
    notify();
    return { playing: true, key };
  } catch (err) {
    teardown();
    throw err;
  }
}

/**
 * @param {File | Blob | string} source
 * @param {string} key
 */
function inferTitle(source, key) {
  if (source && typeof source === "object" && "name" in source && source.name) {
    return String(source.name).replace(/\.[a-z0-9]+$/i, "");
  }
  if (key === "find") return "Key · BPM preview";
  if (key && key !== "default") return "Reference";
  return "Reference";
}

export function pauseAudio() {
  if (audio && !audio.paused) audio.pause();
  notify();
}

export function resumeAudio() {
  if (!audio || !audio.paused) return Promise.resolve(false);
  applyVolume();
  return audio
    .play()
    .then(() => {
      notify();
      return true;
    })
    .catch(() => false);
}

export function togglePlayPause() {
  if (!audio) return Promise.resolve(false);
  if (audio.paused) return resumeAudio();
  pauseAudio();
  return Promise.resolve(true);
}

export function stopAudio() {
  teardown();
}

/** @param {number} seconds */
export function seekAudio(seconds) {
  if (!audio) return 0;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const next = Math.max(0, Math.min(duration || Number.POSITIVE_INFINITY, Number(seconds) || 0));
  audio.currentTime = next;
  notify();
  return next;
}

/** @param {number} ratio 0–1 */
export function seekAudioRatio(ratio) {
  if (!audio) return 0;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (duration <= 0) return 0;
  return seekAudio(duration * Math.max(0, Math.min(1, Number(ratio) || 0)));
}

export function getCurrentTime() {
  return audio ? audio.currentTime || 0 : 0;
}

export function getDuration() {
  return audio && Number.isFinite(audio.duration) ? audio.duration : 0;
}

export function getTitle() {
  return currentTitle;
}

export function isPlaying(key) {
  if (key && currentKey !== key) return false;
  return Boolean(audio && !audio.paused);
}

export function playingKey() {
  return audio && !audio.paused ? currentKey : null;
}

export function activeKey() {
  return currentKey;
}

/** @param {number} value 0–1 */
export function setVolume(value) {
  volume = Math.max(0, Math.min(1, Number(value) || 0));
  if (volume > 0 && muted) muted = false;
  applyVolume();
  notify();
  return volume;
}

export function getVolume() {
  return volume;
}

export function setMuted(on) {
  muted = Boolean(on);
  applyVolume();
  notify();
  return muted;
}

export function toggleMute() {
  return setMuted(!muted);
}

export function isMuted() {
  return muted;
}

export function subscribePlayback(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}
