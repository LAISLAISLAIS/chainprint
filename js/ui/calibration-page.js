/**
 * Wire calibration bench: batch files → CSV rows → download.
 */

import { analyzeFile } from "../analyze.js";
import { buildCsv, downloadCsv, readoutToCsvRow } from "../calibration.js";

const dropzone = document.querySelector("[data-dropzone]");
const fileInput = document.querySelector("[data-file]");
const consoleEl = document.querySelector("[data-console]");
const exportBtn = document.querySelector("[data-export]");
const clearBtn = document.querySelector("[data-clear]");
const lamp = document.querySelector("[data-lamp]");
const statusText = document.querySelector("[data-status]");

const rows = [];
let busy = false;

function setStatus(state, text) {
  if (lamp) lamp.dataset.state = state;
  if (statusText) statusText.textContent = text;
}

function setBusy(on) {
  busy = on;
  dropzone?.classList.toggle("is-busy", on);
  dropzone?.setAttribute("aria-disabled", on ? "true" : "false");
  if (exportBtn) exportBtn.disabled = on || rows.length === 0;
  if (clearBtn) clearBtn.disabled = on || rows.length === 0;
}

function refreshConsole() {
  if (!consoleEl) return;
  consoleEl.textContent = rows.length
    ? `${rows.length} row(s) collected\n\n` + rows.join("\n")
    : "Drop reference tracks. One CSV row per file.";
  if (!busy) {
    const empty = rows.length === 0;
    if (exportBtn) exportBtn.disabled = empty;
    if (clearBtn) clearBtn.disabled = empty;
  }
}

async function handleFiles(fileList) {
  if (busy) return;
  const files = [...fileList].filter(
    (f) => f.type.startsWith("audio/") || /\.(wav|mp3|flac|aiff|m4a)$/i.test(f.name)
  );
  if (!files.length) return;

  setBusy(true);
  setStatus("live", "Measuring batch");
  try {
    for (const file of files) {
      try {
        const result = await analyzeFile(file);
        rows.push(readoutToCsvRow(result.source.name, result.readout));
        console.log("[chainprint:cal]", result.source.name, result.readout, result.traits);
      } catch (err) {
        console.error(file.name, err);
        rows.push(`# ERROR ${file.name}: ${err.message || err}`);
      }
      refreshConsole();
    }
    setStatus("live", `${rows.length} row(s) · estimate`);
  } finally {
    setBusy(false);
    refreshConsole();
  }
}

function openPicker() {
  if (busy || !fileInput) return;
  fileInput.click();
}

if (dropzone && fileInput) {
  dropzone.addEventListener("click", (e) => {
    if (e.target === fileInput || busy) return;
    openPicker();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!busy) dropzone.classList.add("is-drag");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-drag");
    if (!busy) handleFiles(e.dataTransfer?.files || []);
  });
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files || []);
    fileInput.value = "";
  });
}

if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    if (busy) return;
    const dataRows = rows.filter((r) => !r.startsWith("#"));
    if (!dataRows.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`chainprint-calibration-${stamp}.csv`, buildCsv(dataRows));
  });
}

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (busy) return;
    rows.length = 0;
    refreshConsole();
    setStatus("idle", "Calibration idle");
  });
}

refreshConsole();
