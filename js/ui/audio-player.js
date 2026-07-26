/**
 * In-app reference playback — plays the same audio we measured (file or preview).
 */

let audio = null;
/** @type {string | null} */
let objectUrl = null;
/** @type {string | null} */
let currentKey = null;
let volume = 0.85;
let muted = false;
/** @type {Set<(s: { playing: boolean, key: string | null, volume: number, muted: boolean }) => void>} */
const listeners = new Set();

function applyVolume() {
  if (audio) audio.volume = muted ? 0 : volume;
}

function snapshot() {
  return {
    playing: Boolean(audio && !audio.paused),
    key: currentKey,
    volume,
    muted,
  };
}

function notify() {
  const state = snapshot();
  listeners.forEach((fn) => fn(state));
}

function teardown() {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  currentKey = null;
  notify();
}

/**
 * @param {File | Blob | string} source — File/Blob or http(s) URL
 * @param {string} [key] — identity for UI play/pause toggles
 */
export async function playAudio(source, key = "default") {
  if (currentKey === key && audio && !audio.paused) {
    audio.pause();
    notify();
    return { playing: false, key };
  }

  if (currentKey === key && audio && audio.paused) {
    try {
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
  applyVolume();

  if (typeof source === "string") {
    audio.src = source;
  } else {
    objectUrl = URL.createObjectURL(source);
    audio.src = objectUrl;
  }

  audio.addEventListener("ended", () => notify());
  audio.addEventListener("pause", () => notify());
  audio.addEventListener("play", () => notify());

  try {
    await audio.play();
    notify();
    return { playing: true, key };
  } catch (err) {
    teardown();
    throw err;
  }
}

export function pauseAudio() {
  if (audio && !audio.paused) audio.pause();
  notify();
}

export function stopAudio() {
  teardown();
}

export function isPlaying(key) {
  if (key && currentKey !== key) return false;
  return Boolean(audio && !audio.paused);
}

export function playingKey() {
  return audio && !audio.paused ? currentKey : null;
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
