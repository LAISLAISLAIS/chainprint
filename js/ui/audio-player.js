/**
 * In-app reference playback — plays the same audio we measured (file or preview).
 */

let audio = null;
/** @type {string | null} */
let objectUrl = null;
/** @type {string | null} */
let currentKey = null;
/** @type {Set<(s: { playing: boolean, key: string | null }) => void>} */
const listeners = new Set();

function notify() {
  const state = { playing: Boolean(audio && !audio.paused), key: currentKey };
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

export function subscribePlayback(fn) {
  listeners.add(fn);
  fn({ playing: Boolean(audio && !audio.paused), key: currentKey });
  return () => listeners.delete(fn);
}
