/**
 * In-app reference playback — plays the same audio we measured (file or preview).
 * Optional Web Audio chain preview (dry / processed A–B).
 */

import { buildChainFx } from "../audio/chain-fx.js";

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

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {MediaElementAudioSourceNode | null} */
let mediaSource = null;
/** @type {GainNode | null} */
let dryGain = null;
/** @type {GainNode | null} */
let wetGain = null;
/** @type {GainNode | null} */
let masterGain = null;
/** @type {GainNode | null} */
let fxInput = null;
/** @type {ReturnType<typeof buildChainFx> | null} */
let fxGraph = null;
/** @type {object | null} */
let pendingChain = null;
let chainPreview = false;
let graphReady = false;

function ensureContext() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  audioCtx = new AC();
  return audioCtx;
}

function applyVolume() {
  if (masterGain && audioCtx) {
    const v = muted ? 0 : volume;
    masterGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.015);
    if (audio) audio.volume = 1;
    return;
  }
  if (audio) audio.volume = muted ? 0 : volume;
}

function applyPreviewGains(immediate = false) {
  if (!dryGain || !wetGain || !audioCtx) return;
  const t = audioCtx.currentTime;
  const tau = immediate ? 0.005 : 0.02;
  if (chainPreview && fxGraph) {
    dryGain.gain.setTargetAtTime(0, t, tau);
    wetGain.gain.setTargetAtTime(1, t, tau);
  } else {
    dryGain.gain.setTargetAtTime(1, t, tau);
    wetGain.gain.setTargetAtTime(0, t, tau);
  }
}

function disconnectFxOnly() {
  if (fxGraph) {
    fxGraph.dispose();
    fxGraph = null;
  }
  if (fxInput) {
    try {
      fxInput.disconnect();
    } catch {
      /* ignore */
    }
  }
}

function rebuildFxFromPending() {
  if (!audioCtx || !fxInput || !wetGain) return;
  disconnectFxOnly();
  if (!pendingChain) {
    applyPreviewGains(true);
    return;
  }
  fxGraph = buildChainFx(audioCtx, pendingChain);
  if (fxGraph) {
    fxInput.connect(fxGraph.input);
    fxGraph.output.connect(wetGain);
  }
  applyPreviewGains(true);
}

/**
 * Wire MediaElementSource → dry/wet → master once per audio element.
 * Safe to call repeatedly; no-ops if already connected for this element.
 */
function ensureGraph() {
  if (!audio) return false;
  const ctx = ensureContext();
  if (!ctx) return false;

  if (graphReady && mediaSource) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return true;
  }

  try {
    mediaSource = ctx.createMediaElementSource(audio);
  } catch (err) {
    // Element already connected somehow — abandon graph for this session element
    console.warn("[playback] MediaElementSource failed", err);
    return false;
  }

  dryGain = ctx.createGain();
  wetGain = ctx.createGain();
  masterGain = ctx.createGain();
  fxInput = ctx.createGain();
  fxInput.gain.value = 1;

  dryGain.gain.value = 1;
  wetGain.gain.value = 0;
  masterGain.gain.value = muted ? 0 : volume;

  mediaSource.connect(dryGain);
  mediaSource.connect(fxInput);
  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  masterGain.connect(ctx.destination);

  graphReady = true;
  audio.volume = 1;
  rebuildFxFromPending();
  applyVolume();

  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return true;
}

function resetGraphState() {
  disconnectFxOnly();
  dryGain = wetGain = masterGain = fxInput = mediaSource = null;
  graphReady = false;
  // Keep pendingChain + chainPreview so the next playAudio rebuilds FX
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
    chainPreview: Boolean(chainPreview),
    chainFxReady: Boolean(pendingChain && fxGraph),
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
  resetGraphState();
  notify();
}

/**
 * Attach / replace the FX graph from a Chainprint chain object.
 * @param {{ inserts?: object[], sends?: object[] } | null} chain
 */
export function setChainFx(chain) {
  pendingChain = chain && (chain.inserts?.length || chain.sends?.length) ? chain : null;
  if (!pendingChain) {
    chainPreview = false;
  }
  if (graphReady) rebuildFxFromPending();
  notify();
}

/** @param {boolean} on */
export function setChainPreview(on) {
  chainPreview = Boolean(on) && Boolean(pendingChain);
  if (chainPreview) ensureGraph();
  applyPreviewGains(false);
  notify();
  return chainPreview;
}

export function isChainPreview() {
  return Boolean(chainPreview);
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
      ensureGraph();
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
  audio.crossOrigin = "anonymous";
  currentKey = key;
  currentTitle = title;

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

  // Connect graph before play so output routes through Web Audio when available
  ensureGraph();
  applyVolume();

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
  ensureGraph();
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
