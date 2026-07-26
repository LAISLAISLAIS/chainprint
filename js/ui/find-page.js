/**
 * Key · BPM finder page — upload or link → key, relative key, BPM.
 */

import { findKeyBpmFromFile, findKeyBpmFromUrl } from "../find-key-bpm.js";
import { mountAuthNav } from "./nav-auth.js";

mountAuthNav(document.querySelector("[data-auth-nav]"), {
  authHref: "../auth/",
  next: "/find/",
});

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

let busy = false;

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

function setBusy(on) {
  busy = on;
  document.body.classList.toggle("is-finding", on);
  if (goBtn) {
    goBtn.disabled = on;
    goBtn.textContent = on ? "Finding…" : "Find";
  }
  dropzone?.classList.toggle("is-busy", on);
  const title = dropzone?.querySelector(".find-drop-title");
  const sub = dropzone?.querySelector(".find-drop-sub");
  if (title) title.textContent = on ? "Listening…" : "Drop audio here";
  if (sub) sub.textContent = on ? "Measuring key & tempo" : "or click to choose a file";
}

function showResults(result) {
  if (!resultsEl) return;
  resultsEl.hidden = false;

  if (sourceEl) {
    sourceEl.textContent = result.sourceName || "Track";
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
  try {
    const result = await task();
    setStatus("");
    showResults(result);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  } finally {
    setBusy(false);
  }
}

dropzone?.addEventListener("click", () => fileInput?.click());

dropzone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("is-drag");
});

dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));

dropzone?.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-drag");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    run(() => findKeyBpmFromFile(file), "Reading audio…");
  }
});

fileInput?.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    run(() => findKeyBpmFromFile(file), "Reading audio…");
    fileInput.value = "";
  }
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = urlInput?.value?.trim();
  if (!url) {
    setStatus("Paste a track link first.", true);
    return;
  }
  run(() => findKeyBpmFromUrl(url), "Resolving link…");
});
