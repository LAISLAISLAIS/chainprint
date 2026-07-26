/**
 * Key · BPM finder page — upload or link → key, relative key, BPM.
 */

import { findKeyBpmFromFile, findKeyBpmFromUrl } from "../find-key-bpm.js";
import { mountAuthNav } from "./nav-auth.js";
import { mountChainMark } from "./chain-mark.js";
import { playAudio, stopAudio, subscribePlayback, playingKey } from "./audio-player.js";
import { mountPlaybackPulse } from "./playback-pulse.js";

mountAuthNav(document.querySelector("[data-auth-nav]"), {
  authHref: "../auth/",
  next: "/find/",
});

mountPlaybackPulse();

const dropzone = document.querySelector("[data-dropzone]");
const fileInput = document.querySelector("[data-file]");
const form = document.querySelector("[data-link-form]");
const urlInput = document.querySelector("[data-url]");
const goBtn = document.querySelector("[data-link-go]");
const statusEl = document.querySelector("[data-status]");
const resultsEl = document.querySelector("[data-results]");
const sourceEl = document.querySelector("[data-source]");
const bpmEl = document.querySelector("[data-bpm]");
const bpmMeta = document.querySelector("[data-bpm-meta]");
const keyEl = document.querySelector("[data-key]");
const keyMeta = document.querySelector("[data-key-meta]");
const relativeEl = document.querySelector("[data-relative]");
const noteEl = document.querySelector("[data-note]");
const playBtn = document.querySelector("[data-find-play]");
const playLabel = document.querySelector("[data-find-play-label]");
const findMarkRoot = document.querySelector("[data-find-mark]");
const identityRow = document.querySelector("[data-identity]");
const identityInput = document.querySelector("[data-identity-input]");
const identityGo = document.querySelector("[data-identity-go]");

let busy = false;
/** @type {File | Blob | null} */
let lastAudioFile = null;
/** @type {string | null} */
let pendingUrl = null;
/** @type {(() => void) | null} */
let unmountFindMark = null;

subscribePlayback(syncPlayUi);

function setStatus(text, isError = false) {
  if (!statusEl) return;
  if (!text) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", isError);
}

function showIdentity(on, prefill = "") {
  if (!identityRow) return;
  identityRow.hidden = !on;
  if (on && identityInput) {
    if (prefill) identityInput.value = prefill;
    identityInput.focus();
    if (/^\s*[–—-]\s*/.test(prefill)) {
      identityInput.setSelectionRange(0, 0);
    }
  }
}

function setBusy(on) {
  busy = on;
  document.body.classList.toggle("is-finding", on);
  if (goBtn) {
    goBtn.disabled = on;
    goBtn.textContent = on ? "Finding…" : "Find";
  }
  dropzone?.classList.toggle("is-busy", on);
  dropzone?.setAttribute("aria-disabled", on ? "true" : "false");
  const title = dropzone?.querySelector(".find-drop-title");
  const sub = dropzone?.querySelector(".find-drop-sub");
  if (title) title.textContent = on ? "Listening…" : "Drop audio here";
  if (sub) sub.textContent = on ? "Measuring key & tempo" : "or click to choose a file";

  if (on) {
    if (!unmountFindMark && findMarkRoot) {
      unmountFindMark = mountChainMark(findMarkRoot, { variant: "cycle" });
    }
  } else {
    unmountFindMark?.();
    unmountFindMark = null;
  }
}

function syncPlayUi() {
  const on = playingKey() === "find";
  playBtn?.classList.toggle("is-playing", on);
  if (playLabel) playLabel.textContent = on ? "Pause" : "Play";
  playBtn?.setAttribute("aria-label", on ? "Pause reference" : "Play reference");
}

function showResults(result) {
  if (!resultsEl) return;
  resultsEl.hidden = false;
  lastAudioFile = result.audioFile || null;
  pendingUrl = null;
  showIdentity(false);
  stopAudio();

  if (sourceEl) {
    sourceEl.textContent = result.sourceName || "Track";
  }

  if (playBtn) {
    playBtn.hidden = !lastAudioFile;
    syncPlayUi();
  }

  if (bpmEl) {
    bpmEl.textContent = result.bpm != null ? String(result.bpm) : "—";
  }
  if (bpmMeta) {
    bpmMeta.textContent =
      result.bpm == null
        ? "couldn’t lock"
        : result.bpmReliable
          ? result.bpmFeel || "pulse"
          : `low conf. · verify`;
  }

  if (keyEl) {
    keyEl.textContent = result.key || "—";
  }
  if (keyMeta) {
    keyMeta.textContent =
      !result.key
        ? "couldn’t lock"
        : result.keyReliable
          ? `conf ${Math.round((result.keyConfidence || 0) * 100)}%`
          : result.runnerUp
            ? `vs ${result.runnerUp}`
            : "estimate";
  }

  if (relativeEl) {
    relativeEl.textContent = result.relativeKey || "—";
  }

  if (noteEl) {
    const bits = [];
    if (!result.bpmReliable && result.bpm) bits.push("BPM is a best guess — check your DAW grid.");
    if (!result.keyReliable && result.key) bits.push("Key may be ambiguous on dense mixes.");
    if (!bits.length) bits.push("Mix-level estimate · audio stays in your browser.");
    noteEl.textContent = bits.join(" ");
  }
}

async function run(task, label) {
  if (busy) return;
  setBusy(true);
  setStatus(label);
  resultsEl && (resultsEl.hidden = true);
  stopAudio();
  lastAudioFile = null;
  if (playBtn) playBtn.hidden = true;
  try {
    const result = await task();
    setStatus("");
    showResults(result);
  } catch (err) {
    console.error(err);
    const needsIdentity = err.code === "needs_identity" || err.code === "oembed";
    setStatus(err.message || String(err), true);
    if (needsIdentity && pendingUrl) {
      const prefill =
        err.meta?.title && err.meta?.artist
          ? `${err.meta.artist} – ${err.meta.title}`
          : err.meta?.title
            ? ` – ${err.meta.title}`
            : "";
      showIdentity(true, prefill);
    } else {
      showIdentity(false);
    }
  } finally {
    setBusy(false);
  }
}

function openPicker() {
  if (busy || !fileInput) return;
  fileInput.click();
}

playBtn?.addEventListener("click", async () => {
  if (!lastAudioFile) return;
  try {
    const title =
      (sourceEl?.textContent || "").trim() ||
      (lastAudioFile instanceof File && lastAudioFile.name) ||
      "Key · BPM preview";
    await playAudio(lastAudioFile, "find", { title: String(title).replace(/\.[a-z0-9]+$/i, "") });
  } catch (err) {
    console.error(err);
    setStatus("Couldn’t play this clip.", true);
  }
});

dropzone?.addEventListener("click", (e) => {
  if (busy) {
    e.preventDefault();
    return;
  }
  if (e.target === fileInput) return;
  openPicker();
});

dropzone?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openPicker();
  }
});

dropzone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!busy) dropzone.classList.add("is-drag");
});

dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));

dropzone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-drag");
  if (busy) return;
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    pendingUrl = null;
    showIdentity(false);
    run(() => findKeyBpmFromFile(file), "Reading audio…");
  }
});

fileInput?.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    pendingUrl = null;
    showIdentity(false);
    run(() => findKeyBpmFromFile(file), "Reading audio…");
    fileInput.value = "";
  }
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) return;
  const url = urlInput?.value?.trim();
  if (!url) {
    setStatus("Paste a track link first.", true);
    return;
  }
  pendingUrl = url;
  showIdentity(false);
  run(() => findKeyBpmFromUrl(url), "Resolving link…");
});

function submitIdentity() {
  if (busy || !pendingUrl) return;
  const q = identityInput?.value?.trim();
  if (!q) {
    setStatus("Enter artist – song, then try again.", true);
    return;
  }
  run(() => findKeyBpmFromUrl(pendingUrl, { manualQuery: q }), "Finding preview…");
}

identityGo?.addEventListener("click", submitIdentity);
identityInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitIdentity();
  }
});
