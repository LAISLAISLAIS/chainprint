/**
 * Analyze studio: source rail + focused chain stages (no long scroll dump).
 */

import { analyzeFile, analyzeUrl, formatReadoutConsole } from "../analyze.js";
import { loadPluginMap } from "../recommend.js";
import { getSession, logout } from "../auth/session.js";
import {
  analysesRemaining,
  canAnalyze,
  canUseMode,
  consumeAnalysis,
  getPlan,
} from "../auth/quota.js";
import { createLibrary } from "../session/library.js";
import { blendTracks } from "../blend.js";
import { mountAuthNav } from "./nav-auth.js";
import { renderPluginFace } from "./plugin-visuals.js";
import { mountChainMark } from "./chain-mark.js";
import { playAudio, stopAudio, subscribePlayback, playingKey } from "./audio-player.js";
import { mountPlaybackPulse } from "./playback-pulse.js";
import { setPlaybackTrackProvider, notifyPlaylist } from "./playback-playlist.js";
// PDF export is lazy-loaded on click so a CDN failure can't break the studio

const library = createLibrary();

setPlaybackTrackProvider(() =>
  library
    .list()
    .map((entry) => {
      const file = audioFileForEntry(entry);
      if (!file) return null;
      return { id: entry.id, title: entryDisplayName(entry), file };
    })
    .filter(Boolean)
);
let blendWeight = 0.5;
/** When set, successful analysis updates this library id instead of adding */
let updatingEntryId = null;
const studio = document.querySelector(".studio");
const dropzone = document.querySelector("[data-dropzone]");
const fileInput = document.querySelector("[data-file]");
const urlInput = document.querySelector("[data-url]");
const urlGo = document.querySelector("[data-url-go]");
const consoleEl = document.querySelector("[data-console]");
const lampIdle = document.querySelector("[data-lamp-idle]");
const statusText = document.querySelector("[data-status]");
const idleStatus = document.querySelector("[data-idle-status]");
const progressRoot = document.querySelector("[data-progress]");
const progressLabel = document.querySelector("[data-progress-label]");
const progressPct = document.querySelector("[data-progress-pct]");
const progressFill = document.querySelector("[data-progress-fill]");
const progressStages = document.querySelector("[data-progress-stages]");
const readoutRoot = document.querySelector("[data-readouts]");
const bandsRoot = document.querySelector("[data-bands]");
const summaryRoot = document.querySelector("[data-summary]");
const honestyEl = document.querySelector("[data-honesty]");
const estimateNoteEl = document.querySelector("[data-estimate-note]");
const highlightsRoot = document.querySelector("[data-highlights]");
const highlightsWhy = document.querySelector("[data-highlights-why]");
const trackCard = document.querySelector("[data-track-card]");
const trackArt = document.querySelector("[data-track-art]");
const trackTitle = document.querySelector("[data-track-title]");
const trackMeta = document.querySelector("[data-track-meta]");
const trackPlayBtn = document.querySelector("[data-track-play]");
const identityRow = document.querySelector("[data-identity]");
const identityInput = document.querySelector("[data-identity-input]");
const identityGo = document.querySelector("[data-identity-go]");
const workspace = document.querySelector("[data-workspace]");
const gateAuth = document.querySelector('[data-gate="auth"]');
const gateQuota = document.querySelector('[data-gate="quota"]');
const quotaBar = document.querySelector("[data-quota-bar]");
const quotaLabel = document.querySelector("[data-quota-label]");
const quotaLeft = document.querySelector("[data-quota-left]");
const modeStandardBtn = document.querySelector('[data-mode="standard"]');
const modeDeepBtn = document.querySelector('[data-mode="deep"]');
const emptyEl = document.querySelector("[data-empty]");
const chainWorkspace = document.querySelector("[data-chain-workspace]");
const stageRailInserts = document.querySelector("[data-stage-rail-inserts]");
const stageRailSends = document.querySelector("[data-stage-rail-sends]");
const stageFocus = document.querySelector("[data-stage-focus]");
const stageCount = document.querySelector("[data-stage-count]");
const stagePrev = document.querySelector("[data-stage-prev]");
const stageNext = document.querySelector("[data-stage-next]");
const exportPdfBtn = document.querySelector("[data-export-pdf]");
const viewTabs = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-panel]");
const masterEmpty = document.querySelector("[data-master-empty]");
const masterBody = document.querySelector("[data-master-body]");
const masterReadouts = document.querySelector("[data-master-readouts]");
const masterNotes = document.querySelector("[data-master-notes]");
const masterSteps = document.querySelector("[data-master-steps]");
const masterBands = document.querySelector("[data-master-bands]");
const designEmpty = document.querySelector("[data-design-empty]");
const designBody = document.querySelector("[data-design-body]");
const designHeadline = document.querySelector("[data-design-headline]");
const designBlurb = document.querySelector("[data-design-blurb]");
const designLayers = document.querySelector("[data-design-layers]");
const designChecklist = document.querySelector("[data-design-checklist]");
const libraryList = document.querySelector("[data-library-list]");
const libraryCount = document.querySelector("[data-library-count]");
const libraryHint = document.querySelector("[data-library-hint]");
const blendPanel = document.querySelector("[data-blend-panel]");
const blendSlotA = document.querySelector('[data-blend-slot="a"]');
const blendSlotB = document.querySelector('[data-blend-slot="b"]');
const blendGo = document.querySelector("[data-blend-go]");
const blendWeightBtns = document.querySelectorAll("[data-blend-weight]");

let pluginMap = null;
/** @type {{ kind: 'file', file: File } | { kind: 'url', url: string, manualQuery?: string } | null} */
let lastSource = null;
let shouldConsumeQuota = false;
/** @type {'standard' | 'deep'} */
let analysisMode = "standard";
/** @type {object | null} */
let lastAdvice = null;
/** @type {string} */
let lastTrackName = "";
/** @type {Array<{ step: object, kind: 'insert' | 'send', index: number }>} */
let stages = [];
let stageIndex = 0;
/** @type {'chain' | 'signature' | 'design' | 'master' | 'why'} */
let activeView = "chain";
/** @type {(() => void) | null} */
let unmountHeroMark = null;
let analyzing = false;
let analysisGen = 0;
let blending = false;

mountAuthNav(document.querySelector("[data-auth-nav]"), {
  authHref: "../auth/",
  next: "/analyze/",
});

mountPlaybackPulse();
let lastPlaySig = "";
subscribePlayback((state) => {
  const sig = `${state.playing ? 1 : 0}:${state.key || ""}`;
  if (sig === lastPlaySig) return;
  lastPlaySig = sig;
  syncPlayButtons();
});

function refreshQuotaChrome() {
  const account = getSession();
  if (!account || !quotaBar) return;
  const plan = getPlan(account);
  const left = analysesRemaining(account);
  quotaBar.classList.remove("hidden");
  if (quotaLabel) quotaLabel.textContent = plan.label;
  if (quotaLeft) {
    quotaLeft.textContent = left === Infinity ? "Unlimited" : `${left} left`;
  }

  const deep = canUseMode("deep", account);
  if (modeDeepBtn) {
    const locked = !account || deep.reason === "deep_locked";
    modeDeepBtn.disabled = locked;
    modeDeepBtn.querySelector(".lock")?.remove();
    if (locked) {
      const lock = document.createElement("span");
      lock.className = "lock";
      lock.textContent = "Pro";
      modeDeepBtn.appendChild(lock);
    }
  }
}

function applyAccessGate() {
  const account = getSession();
  // Keep the studio visible under the gate so DAW / layout stay discoverable
  workspace?.classList.remove("hidden");
  workspace?.removeAttribute("aria-hidden");

  if (!account) {
    gateAuth?.classList.remove("hidden");
    gateQuota?.classList.add("hidden");
    return false;
  }

  gateAuth?.classList.add("hidden");
  const access = canAnalyze(account);
  if (!access.ok) {
    gateQuota?.classList.remove("hidden");
    return false;
  }

  gateQuota?.classList.add("hidden");
  refreshQuotaChrome();
  return true;
}

document.querySelector("[data-logout-gate]")?.addEventListener("click", () => {
  logout();
  location.href = "../auth/?mode=login&next=/analyze/";
});

document.querySelector("[data-upgrade-soon]")?.addEventListener("click", () => {
  alert("Paid plans aren’t live yet — this is where upgrade / billing will land.");
});

function setMode(mode) {
  if (analyzing || blending) return;
  if (mode === "deep" && !canUseMode("deep").ok) return;
  const changed = analysisMode !== mode;
  analysisMode = mode;
  modeStandardBtn?.setAttribute("aria-pressed", String(mode === "standard"));
  modeDeepBtn?.setAttribute("aria-pressed", String(mode === "deep"));
  if (!changed) return;

  const active = library.active();
  if (active?.kind === "blend" && active.blendOf?.length === 2) {
    rebuildBlend(active);
    return;
  }
  if (active?.source && active.source.kind !== "blend") {
    lastSource = active.source;
    updatingEntryId = active.id;
    shouldConsumeQuota = false;
    runAnalysis();
  } else if (lastSource && lastSource.kind !== "blend") {
    shouldConsumeQuota = false;
    runAnalysis();
  }
}

modeStandardBtn?.addEventListener("click", () => setMode("standard"));
modeDeepBtn?.addEventListener("click", () => setMode("deep"));
setMode(canUseMode("deep").ok ? "deep" : "standard");

function setView(view) {
  if (!lastAdvice && view !== "chain") return;
  if (view === "master" && !lastAdvice?.master) return;
  if (view === "design" && !lastAdvice?.design) return;
  activeView = view;
  viewTabs.forEach((tab) => {
    const v = tab.getAttribute("data-view");
    tab.setAttribute("aria-pressed", String(v === view));
  });
  panels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.getAttribute("data-panel") === view);
  });
}

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const v = tab.getAttribute("data-view");
    if (!v || tab.disabled) return;
    setView(/** @type {'chain' | 'signature' | 'design' | 'master' | 'why'} */ (v));
  });
});

function setStatus(state, text) {
  if (lampIdle) lampIdle.dataset.state = state;
  if (statusText) statusText.textContent = text;
}

function audioFileForEntry(entry) {
  if (!entry) return null;
  if (entry.audioFile instanceof Blob) return entry.audioFile;
  if (entry.source?.kind === "file" && entry.source.file instanceof Blob) return entry.source.file;
  return null;
}

function syncPlayButtons() {
  const key = playingKey();
  const active = library.active();
  const activePlayable = Boolean(audioFileForEntry(active));

  if (trackPlayBtn) {
    const show = Boolean(active && activePlayable);
    trackPlayBtn.hidden = !show;
    const on = show && key === active?.id;
    trackPlayBtn.classList.toggle("is-playing", on);
    trackPlayBtn.setAttribute("aria-label", on ? "Pause reference" : "Play reference");
  }

  libraryList?.querySelectorAll("[data-library-play]").forEach((btn) => {
    const id = btn.getAttribute("data-library-play");
    const on = key === id;
    btn.classList.toggle("is-playing", on);
    btn.setAttribute("aria-label", on ? "Pause" : "Play");
  });
}

async function toggleEntryPlayback(entry) {
  const file = audioFileForEntry(entry);
  if (!file || !entry) return;
  try {
    await playAudio(file, entry.id, { title: entryDisplayName(entry) });
  } catch (err) {
    console.error(err);
    setStatus("idle", "Couldn’t play this reference");
  }
}

function setProgress(on, { label = "", progress = 0, stage = "" } = {}) {
  if (!progressRoot) return;
  progressRoot.classList.toggle("hidden", !on);
  idleStatus?.classList.toggle("hidden", on);
  document.body.classList.toggle("is-analyzing", on);
  document.querySelector("[data-workspace]")?.classList.toggle("is-analyzing", on);
  dropzone?.classList.toggle("is-busy", on);
  if (urlGo) urlGo.disabled = on;
  if (identityGo) identityGo.disabled = on;
  modeStandardBtn && (modeStandardBtn.disabled = on || blending);
  modeDeepBtn && (modeDeepBtn.disabled = on || blending || !canUseMode("deep").ok);
  if (blendGo) blendGo.disabled = on || blending || !library.canBlend();

  if (!on) {
    unmountHeroMark?.();
    unmountHeroMark = null;
    if (progressFill) progressFill.style.width = "0%";
    return;
  }

  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  if (progressLabel) progressLabel.textContent = label || "Working…";
  if (progressPct) progressPct.textContent = `${pct}%`;
  if (progressFill) progressFill.style.width = `${pct}%`;

  const stageMap = {
    resolving: "loading",
    downloading: "loading",
    loading: "loading",
    decoding: "decoding",
    measuring: "measuring",
    characterizing: "measuring",
    building: "building",
    done: "building",
  };
  const active = stageMap[stage] || "";
  progressStages?.querySelectorAll("li").forEach((li) => {
    const key = li.getAttribute("data-stage");
    li.classList.toggle("is-active", key === active);
    const order = ["loading", "decoding", "measuring", "building"];
    const ai = order.indexOf(active);
    const li_i = order.indexOf(key);
    li.classList.toggle("is-done", ai >= 0 && li_i >= 0 && li_i < ai);
  });
}

function showIdentity(on, prefill = "") {
  if (!identityRow) return;
  identityRow.classList.toggle("hidden", !on);
  if (on && identityInput) {
    if (prefill) identityInput.value = prefill;
    identityInput.focus();
    // " – Song Title" → cursor at start so they type the artist first
    if (/^\s*[–—-]\s*/.test(prefill)) {
      identityInput.setSelectionRange(0, 0);
    }
  }
}

function showTrackCard(meta) {
  if (!trackCard) return;
  if (!meta) {
    trackCard.classList.add("hidden");
    if (trackPlayBtn) trackPlayBtn.hidden = true;
    return;
  }
  const title = meta.matchedTitle || meta.title || "Reference";
  const artist = meta.matchedArtist || meta.artist || "";
  if (trackTitle) trackTitle.textContent = artist ? `${artist} — ${title}` : title;
  lastTrackName = artist ? `${artist} — ${title}` : title;
  if (trackMeta) {
    const bits = [
      meta.platform,
      meta.preview ? "30s preview" : "full file",
      meta.previewSource ? `via ${meta.previewSource}` : null,
      meta.blend ? "combination" : null,
    ].filter(Boolean);
    trackMeta.textContent = bits.join(" · ");
  }
  if (trackArt) {
    if (meta.artwork) {
      trackArt.src = meta.artwork;
      trackArt.alt = title;
      trackArt.hidden = false;
    } else {
      trackArt.removeAttribute("src");
      trackArt.hidden = true;
    }
  }
  trackCard.classList.remove("hidden");
  syncPlayButtons();
}

function entryDisplayName(entry) {
  return entry.name || "Reference";
}

function renderLibrary() {
  const entries = library.list();
  const active = library.active();
  const picks = new Set(library.blendPicks().map((e) => e.id));

  if (libraryCount) libraryCount.textContent = String(entries.length);

  if (libraryList) {
    libraryList.innerHTML = entries
      .map((entry) => {
        const isActive = active?.id === entry.id;
        const picked = picks.has(entry.id);
        const canPick = entry.kind === "track" && entry.result;
        const art = entry.artwork
          ? `<img class="library-item-art" src="${escapeHtml(entry.artwork)}" alt="" />`
          : `<span class="library-item-art is-blank">${entry.kind === "blend" ? "×" : "REF"}</span>`;
        const meta =
          entry.kind === "blend"
            ? "Combination mix"
            : entry.result
              ? entry.result.mode === "deep"
                ? "Deep · ready"
                : "Ready"
              : "Analyzing…";
        const canPlay = Boolean(audioFileForEntry(entry));
        return `
          <li>
            <div class="library-item ${isActive ? "is-active" : ""}" data-library-id="${escapeHtml(entry.id)}">
              ${
                canPick
                  ? `<button type="button" class="library-check ${picked ? "is-on" : ""}" data-library-pick="${escapeHtml(entry.id)}" aria-label="Select for combine" aria-pressed="${picked}"></button>`
                  : `<span class="library-check" style="opacity:0;pointer-events:none"></span>`
              }
              <button type="button" class="library-item-main" data-library-select="${escapeHtml(entry.id)}">
                ${art}
                <span class="library-item-copy">
                  <span class="library-item-title">${escapeHtml(entryDisplayName(entry))}</span>
                  <span class="library-item-meta">${escapeHtml(meta)}</span>
                </span>
              </button>
              <div class="library-item-actions">
              ${
                canPlay
                  ? `<button type="button" class="library-item-play" data-library-play="${escapeHtml(entry.id)}" aria-label="Play"><span class="library-item-play-icon" aria-hidden="true"></span></button>`
                  : ""
              }
              <button type="button" class="library-item-remove" data-library-remove="${escapeHtml(entry.id)}" aria-label="Remove">×</button>
              </div>
            </div>
          </li>`;
      })
      .join("");
  }

  const trackCount = entries.filter((e) => e.kind === "track" && e.result).length;
  blendPanel?.classList.toggle("hidden", trackCount < 2);

  const [a, b] = library.blendPicks();
  if (blendSlotA) {
    blendSlotA.textContent = a ? entryDisplayName(a) : "A · select";
    blendSlotA.classList.toggle("is-filled", Boolean(a));
  }
  if (blendSlotB) {
    blendSlotB.textContent = b ? entryDisplayName(b) : "B · select";
    blendSlotB.classList.toggle("is-filled", Boolean(b));
  }
  if (blendGo) blendGo.disabled = !library.canBlend();

  if (libraryHint) {
    if (!entries.length) {
      libraryHint.textContent = "Load multiple refs, then click one to view its chain.";
      libraryHint.classList.remove("is-ready");
    } else if (trackCount >= 2) {
      libraryHint.textContent = "Check two tracks below, set balance, then Build combination.";
      libraryHint.classList.add("is-ready");
    } else {
      libraryHint.textContent = "Add another reference to unlock Combine mixes.";
      libraryHint.classList.add("is-ready");
    }
  }

  syncPlayButtons();
  notifyPlaylist();
}

function applyEntryToStudio(entry) {
  if (!entry?.result) {
    setHasResults(false);
    renderMaster(null);
    renderDesign(null);
    return;
  }
  const { result } = entry;
  lastAdvice = result.advice || null;
  lastSource = entry.source?.kind === "blend" ? { kind: "blend" } : entry.source;
  lastTrackName = entryDisplayName(entry);

  showTrackCard(
    entry.meta || {
      title: entry.name,
      artwork: entry.artwork,
      blend: entry.kind === "blend",
      platform: entry.kind === "blend" ? "Blend" : null,
    }
  );

  renderChain(result.advice);
  renderMaster(result.advice?.master || null);
  renderDesign(result.advice?.design || null);
  renderSummary(result.traits, result.advice);
  renderReadouts(result.readout, result.traits);
  renderBands(result.readout.bands);
  if (consoleEl) {
    consoleEl.textContent = formatReadoutConsole({
      source: { name: entry.name, origin: entry.kind, meta: entry.meta },
      readout: result.readout,
      traits: result.traits,
      advice: result.advice,
    });
  }

  if (estimateNoteEl && result.advice?.estimateNote) {
    estimateNoteEl.textContent = result.advice.estimateNote;
  } else if (estimateNoteEl && entry.kind === "blend") {
    estimateNoteEl.textContent = "Combination mix — A/B both source refs while you dial.";
  }

  setHasResults(true);
  setStatus("live", entry.kind === "blend" ? "Combination ready" : "Chain ready");
}

function selectLibraryEntry(id) {
  const entry = library.setActive(id);
  if (!entry) return;
  renderLibrary();
  if (entry.result) applyEntryToStudio(entry);
}

async function rebuildBlend(existing = null) {
  if (analyzing || blending) return;
  const picks = existing?.blendOf
    ? existing.blendOf.map((id) => library.get(id)).filter(Boolean)
    : library.blendPicks();
  if (picks.length !== 2) return;

  const [a, b] = picks;
  if (!a.result || !b.result) {
    alert("Both tracks need a finished analysis first.");
    return;
  }

  blending = true;
  if (blendGo) blendGo.disabled = true;

  if (!pluginMap) {
    pluginMap = await loadPluginMap();
  }

  setProgress(true, { label: "Blending signatures…", progress: 0.4, stage: "building" });
  setStatus("live", "Combining mixes");

  try {
    const weight = existing?.weight ?? blendWeight;
    const blended = blendTracks(a, b, { weight, pluginMap, mode: analysisMode });
    const name = `${a.name} × ${b.name}`;
    const payload = {
      kind: "blend",
      name,
      artwork: a.artwork || b.artwork || null,
      meta: {
        title: name,
        blend: true,
        platform: "Blend",
        artwork: a.artwork || b.artwork || null,
      },
      source: { kind: "blend" },
      result: blended,
      blendOf: [a.id, b.id],
      weight,
    };

    let entry;
    if (existing) {
      entry = library.update(existing.id, payload);
      library.setActive(existing.id);
    } else {
      entry = library.add(payload);
      library.clearBlendPicks();
    }

    renderLibrary();
    applyEntryToStudio(entry);
    setProgress(false);
    setStatus("live", "Combination ready");
  } catch (err) {
    console.error(err);
    setProgress(false);
    alert(err.message || "Could not blend those mixes.");
    setStatus("idle", "Blend failed");
  } finally {
    blending = false;
    if (blendGo) blendGo.disabled = !library.canBlend();
  }
}

function setHasResults(on) {
  studio?.classList.toggle("has-results", on);
  if (emptyEl) emptyEl.classList.toggle("hidden", on);
  if (chainWorkspace) {
    if (on) chainWorkspace.classList.remove("hidden");
    else chainWorkspace.classList.add("hidden");
  }
  if (exportPdfBtn) exportPdfBtn.disabled = !on;
  viewTabs.forEach((tab) => {
    const v = tab.getAttribute("data-view");
    if (v === "chain") return;
    if (v === "master") {
      tab.disabled = !on || !lastAdvice?.master;
      return;
    }
    if (v === "design") {
      tab.disabled = !on || !lastAdvice?.design;
      return;
    }
    tab.disabled = !on;
  });
  if (!on) setView("chain");
}

function bandWidthPct(dbRel) {
  const min = -35;
  const max = -5;
  const t = (dbRel - min) / (max - min);
  return `${Math.max(4, Math.min(100, t * 100))}%`;
}

function renderBands(bands) {
  if (!bandsRoot) return;
  bandsRoot.innerHTML = bands
    .map(
      (b) => `
      <div class="band-row">
        <span class="name">${b.label}</span>
        <div class="band-track" title="${b.lo}–${b.hi} Hz">
          <div class="band-fill" style="width:${bandWidthPct(b.dbRelTotal)}"></div>
        </div>
        <span class="db">${b.dbRelTotal.toFixed(1)}</span>
      </div>`
    )
    .join("");
}

function renderReadouts(readout, traits) {
  if (!readoutRoot) return;
  const items = [];
  if (readout.tempo?.bpm) {
    items.push([
      "BPM",
      `${readout.tempo.bpm}`,
      readout.tempo.reliable
        ? readout.tempo.feel || "pulse"
        : `low conf. ${Math.round((readout.tempo.confidence || 0) * 100)}%`,
    ]);
  }
  if (readout.pitch?.keyLabel) {
    const conf = Math.round((readout.pitch.keyConfidence || 0) * 100);
    if (readout.pitch.keyReliable) {
      items.push(["Key", readout.pitch.keyLabel, `conf ${conf}%`]);
    } else {
      items.push([
        "Key?",
        readout.pitch.keyLabel,
        `leaning · vs ${readout.pitch.keyRunnerUp || "—"}`,
      ]);
    }
    if (readout.pitch.relativeKey) {
      items.push(["Relative", readout.pitch.relativeKey, "same signature"]);
    }
  } else if (readout.pitch?.keyCandidates?.[0]) {
    items.push([
      "Key?",
      readout.pitch.keyCandidates[0].label,
      `ambiguous vs ${readout.pitch.keyRunnerUp || "—"}`,
    ]);
  }
  if (readout.pitch?.f0Hz && (readout.pitch.f0Reliable || readout.pitch.voicedFrames > 4)) {
    items.push([
      "F0",
      `${readout.pitch.f0Hz.toFixed(0)} Hz`,
      readout.pitch.noteName || readout.pitch.register || "register",
    ]);
  }
  items.push(
    ["Centroid", `${readout.centroidHz.toFixed(0)} Hz`, "vocal-weighted"],
    ["Crest", `${readout.dynamics.crestDb.toFixed(1)} dB`, traits.dynamics],
    ["RMS", `${readout.dynamics.rmsDb.toFixed(1)} dB`, "level"],
    ["Range", `${readout.dynamics.shortTermRangeDb.toFixed(1)} dB`, "short-term"],
    ["Air", `${readout.tone.air.toFixed(1)}`, traits.tone.air],
    ["Sibilance", `${readout.tone.sibilance.toFixed(1)}`, traits.tone.sibilance],
    ["Harsh", `${readout.tone.harshness.toFixed(1)}`, traits.tone.harshness],
    ["Mud", `${readout.tone.mud.toFixed(1)}`, traits.tone.mud],
    ["Corr", readout.stereo.correlation.toFixed(2), traits.stereo],
    ["Side/Mid", readout.stereo.sideMidRatio.toFixed(2), "stereo"]
  );
  if (readout.loudness?.lufsProxy != null) {
    items.push(["Loud ≈", `${readout.loudness.lufsProxy.toFixed(1)}`, "proxy · not LUFS"]);
  }
  if (readout.transientIndex != null) {
    items.push(["Transients", `${readout.transientIndex.toFixed(1)}`, traits.deep?.attackFeel || "index"]);
  }
  if (readout.eqTargets) {
    items.push([
      "EQ peaks",
      `${readout.eqTargets.mudHz} / ${readout.eqTargets.harshHz}`,
      "mud · harsh Hz",
    ]);
  }
  if (traits.deep) {
    items.push(["Density", traits.deep.denseness.replace(/_/g, " "), "Pro"]);
    items.push(["Delivery", traits.deep.delivery.replace(/_/g, " "), "Pro"]);
    if (traits.deep.designLane) {
      items.push(["Lane", traits.deep.designLane.replace(/_/g, " "), "Deep design"]);
    }
    if (traits.deep.spaceCharacter) {
      items.push(["Space", traits.deep.spaceCharacter.replace(/_/g, " "), "Deep"]);
    }
  }
  readoutRoot.innerHTML = items
    .map(
      ([key, value, sub]) =>
        `<div class="readout"><span class="key">${key}</span><span class="value">${value}</span><span class="sub">${sub}</span></div>`
    )
    .join("");
}

function renderDesign(design) {
  const has = Boolean(design);
  designEmpty?.classList.toggle("hidden", has);
  designBody?.classList.toggle("hidden", !has);
  if (!has || !design) return;

  if (designHeadline) designHeadline.textContent = design.headline || "Deep design lane";
  if (designBlurb) designBlurb.textContent = design.blurb || "";

  if (designLayers) {
    designLayers.innerHTML = (design.layers || [])
      .map((layer) => {
        const moves = (layer.moves || []).map((m) => `<li>${escapeHtml(m)}</li>`).join("");
        const tools = (layer.tools || [])
          .map(
            (a) => `
            <div class="pro-pick">
              <div>
                <p class="pro-pick-name">${escapeHtml(a.name)}</p>
                <p class="pro-pick-meta">${escapeHtml(a.brand)} · ${escapeHtml(a.role)}</p>
                <p class="pro-pick-why">${escapeHtml(a.why)}</p>
              </div>
              <a class="pro-pick-buy" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer sponsored">View deal</a>
              <p class="pro-pick-note">Affiliate link · we may earn a commission</p>
            </div>`
          )
          .join("");
        return `
          <article class="design-layer">
            <h3>${escapeHtml(layer.title)}</h3>
            <p class="design-intent">${escapeHtml(layer.intent)}</p>
            ${moves ? `<ul class="rack-copy">${moves}</ul>` : ""}
            ${tools ? `<div class="pro-picks"><p class="pro-picks-label">Tools</p>${tools}</div>` : ""}
          </article>`;
      })
      .join("");
  }

  if (designChecklist) {
    designChecklist.innerHTML = (design.checklist || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join("");
  }
}

function renderMaster(master) {
  const has = Boolean(master);
  masterEmpty?.classList.toggle("hidden", has);
  masterBody?.classList.toggle("hidden", !has);
  if (!has || !master) return;

  const r = master.readouts || {};
  const items = [
    ["Peak", r.peakDb != null ? `${r.peakDb.toFixed(1)} dB` : "—", "full mix"],
    ["RMS", r.rmsDb != null ? `${r.rmsDb.toFixed(1)} dB` : "—", "full mix"],
    ["Crest", r.crestDb != null ? `${r.crestDb.toFixed(1)} dB` : "—", "density"],
    ["Loud ≈", r.lufsProxy != null ? r.lufsProxy.toFixed(1) : "—", "proxy"],
    ["Corr", r.correlation != null ? r.correlation.toFixed(2) : "—", "mono check"],
    ["Side/Mid", r.sideMidRatio != null ? r.sideMidRatio.toFixed(2) : "—", "width"],
    ["Centroid", r.centroidHz != null ? `${r.centroidHz.toFixed(0)} Hz` : "—", "full mix"],
  ];
  if (r.bpm) items.splice(0, 0, ["BPM", `${r.bpm}`, "estimate"]);
  if (r.keyLabel) items.splice(r.bpm ? 1 : 0, 0, ["Key", r.keyLabel, "estimate"]);
  if (r.relativeKey) {
    items.splice(r.bpm ? (r.keyLabel ? 2 : 1) : r.keyLabel ? 1 : 0, 0, [
      "Relative",
      r.relativeKey,
      "same signature",
    ]);
  }
  if (masterReadouts) {
    masterReadouts.innerHTML = items
      .map(
        ([key, value, sub]) =>
          `<div class="readout"><span class="key">${key}</span><span class="value">${value}</span><span class="sub">${sub}</span></div>`
      )
      .join("");
  }
  if (masterNotes) {
    masterNotes.innerHTML = (master.notes || []).map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  }
  if (masterBands && master.bands) {
    masterBands.innerHTML = master.bands
      .map(
        (b) => `
      <div class="band-row">
        <span class="name">${b.label}</span>
        <div class="band-track" title="${b.lo}–${b.hi} Hz">
          <div class="band-fill" style="width:${bandWidthPct(b.dbRelTotal)}"></div>
        </div>
        <span class="db">${b.dbRelTotal.toFixed(1)}</span>
      </div>`
      )
      .join("");
  }
  if (masterSteps) {
    masterSteps.innerHTML = (master.steps || [])
      .map((step, i) => {
        const aff = (step.affiliates || [])
          .map(
            (a) => `
            <a class="aff-chip" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer sponsored">
              ${escapeHtml(a.name)}
            </a>`
          )
          .join("");
        const lines = (step.copy || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
        return `
          <article class="master-step">
            <div class="master-step-head">
              <span class="xp-n">${String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>${escapeHtml(step.title)}</h3>
                <p>${escapeHtml(step.plugin)}</p>
              </div>
              <span class="type-badge">${escapeHtml(step.type)}</span>
            </div>
            ${lines ? `<ul class="rack-copy">${lines}</ul>` : ""}
            ${step.why ? `<p class="master-why">${escapeHtml(step.why)}</p>` : ""}
            ${
              aff
                ? `<div class="aff-row">
                    <span class="aff-row-label">Tools</span>
                    <div class="aff-chips">${aff}</div>
                    <p class="pro-pick-note">Affiliate · we may earn a commission</p>
                  </div>`
                : ""
            }
          </article>`;
      })
      .join("");
  }
}

function renderAffiliates(step) {
  const list = step.affiliates || [];
  if (!list.length) return "";
  return `
    <div class="pro-picks">
      <p class="pro-picks-label">Pro plugins · engineer staples</p>
      ${list
        .map(
          (a) => `
        <div class="pro-pick">
          <div>
            <p class="pro-pick-name">${escapeHtml(a.name)}</p>
            <p class="pro-pick-meta">${escapeHtml(a.brand)} · ${escapeHtml(a.role)}</p>
            <p class="pro-pick-why">${escapeHtml(a.why)}</p>
          </div>
          <a class="pro-pick-buy" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer sponsored">View deal</a>
          <p class="pro-pick-note">Affiliate link · we may earn a commission at no extra cost to you</p>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderSummary(traits, advice) {
  if (!summaryRoot) return;
  const extra = advice?.chain?.orderWhy?.map((s) => s) || [];
  const items = [...traits.summary, ...extra];
  summaryRoot.innerHTML = items.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
}

function tierLabel(tier) {
  if (!tier || tier === "stock") return "Built-in";
  if (tier === "free") return "Free";
  if (tier === "paid") return "Paid";
  return tier;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stageChip(entry, globalIndex) {
  const { step, kind } = entry;
  const type = step.type || (kind === "send" ? "Send" : "Insert");
  return `
    <button type="button" class="stage-chip" role="tab" data-stage-index="${globalIndex}" aria-selected="false">
      <span class="stage-chip-n">${kind === "send" ? "Send" : `Step ${entry.index + 1}`}</span>
      <span class="stage-chip-title">${escapeHtml(step.title)}</span>
      <span class="stage-chip-type">${escapeHtml(type)}</span>
    </button>`;
}

function renderFocus() {
  const entry = stages[stageIndex];
  if (!entry || !stageFocus) {
    if (stageFocus) stageFocus.innerHTML = "";
    return;
  }

  const { step, kind, index } = entry;
  const gap = step.gap ? `<p class="gap">${escapeHtml(step.gap)}</p>` : "";
  const type = step.type || (kind === "send" ? "Send" : "Insert");
  const face = renderPluginFace(step);
  const tips =
    step.why || step.how
      ? `<details class="step-tips">
          <summary>Why this setting</summary>
          ${step.why ? `<p class="why">${escapeHtml(step.why)}</p>` : ""}
          ${step.how ? `<p class="how">${escapeHtml(step.how)}</p>` : ""}
        </details>`
      : "";
  const affiliates = analysisMode === "deep" ? renderAffiliates(step) : "";

  stageFocus.innerHTML = `
    <article class="chain-step">
      <header class="step-block">
        <div class="step-head">
          <span class="step-index">${kind === "send" ? "Send" : `Step ${index + 1}`}</span>
          <span class="type-badge">${escapeHtml(type)}</span>
          <span class="tier">${tierLabel(step.tier)}</span>
        </div>
        <h3 class="step-title">${escapeHtml(step.title)}</h3>
        ${gap}
      </header>
      <div class="step-block">
        ${face}
      </div>
      <div class="step-block step-block--meta">
        ${tips}
        ${affiliates}
      </div>
    </article>`;

  stageFocus.scrollTop = 0;

  document.querySelectorAll("[data-stage-index]").forEach((btn) => {
    const i = Number(btn.getAttribute("data-stage-index"));
    btn.setAttribute("aria-selected", String(i === stageIndex));
  });

  if (stageCount) stageCount.textContent = `${stageIndex + 1} / ${stages.length}`;
  if (stagePrev) stagePrev.disabled = stageIndex <= 0;
  if (stageNext) stageNext.disabled = stageIndex >= stages.length - 1;
}

function selectStage(index) {
  if (!stages.length) return;
  stageIndex = Math.max(0, Math.min(stages.length - 1, index));
  renderFocus();
}

function bindStageRail(root) {
  root?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stage-index]");
    if (!btn) return;
    selectStage(Number(btn.getAttribute("data-stage-index")));
  });
}

bindStageRail(stageRailInserts);
bindStageRail(stageRailSends);

exportPdfBtn?.addEventListener("click", async () => {
  if (!lastAdvice?.chain || !exportPdfBtn) return;
  const label = exportPdfBtn.textContent;
  exportPdfBtn.classList.add("is-busy");
  exportPdfBtn.textContent = "Exporting…";
  try {
    const { downloadChainPdf } = await import("../export/chain-pdf.js");
    await downloadChainPdf(lastAdvice, { trackName: lastTrackName || undefined });
  } catch (err) {
    console.error(err);
    alert(err.message || "Could not export PDF. Check your connection and try again.");
  } finally {
    exportPdfBtn.classList.remove("is-busy");
    exportPdfBtn.textContent = label || "Export PDF";
  }
});

stagePrev?.addEventListener("click", () => selectStage(stageIndex - 1));
stageNext?.addEventListener("click", () => selectStage(stageIndex + 1));

document.addEventListener("keydown", (e) => {
  if (activeView !== "chain" || !stages.length) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    selectStage(stageIndex - 1);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    selectStage(stageIndex + 1);
  }
});

function renderChain(advice) {
  lastAdvice = advice || null;
  if (!advice?.chain) {
    stages = [];
    setHasResults(false);
    if (honestyEl) honestyEl.textContent = "";
    if (estimateNoteEl) estimateNoteEl.textContent = "";
    if (stageRailInserts) stageRailInserts.innerHTML = "";
    if (stageRailSends) stageRailSends.innerHTML = "";
    if (stageFocus) stageFocus.innerHTML = "";
    if (highlightsRoot) highlightsRoot.innerHTML = "";
    return;
  }

  const { chain } = advice;
  if (honestyEl) honestyEl.textContent = chain.honesty;
  if (estimateNoteEl) {
    estimateNoteEl.textContent =
      advice.estimateNote ||
      (advice.mode === "deep"
        ? "Pro chain — match values in your plugins, then open Master for the bus pass."
        : "Match each stage in order. Switch to Deep for Pro plugins + master analysis.");
  }

  const insertStages = (chain.inserts || []).map((step, index) => ({
    step,
    kind: /** @type {'insert'} */ ("insert"),
    index,
  }));
  const sendStages = (chain.sends || []).map((step, index) => ({
    step,
    kind: /** @type {'send'} */ ("send"),
    index,
  }));
  stages = [...insertStages, ...sendStages];

  if (stageRailInserts) {
    stageRailInserts.innerHTML = insertStages.map((e, i) => stageChip(e, i)).join("");
  }
  if (stageRailSends) {
    const offset = insertStages.length;
    stageRailSends.innerHTML = sendStages.map((e, i) => stageChip(e, offset + i)).join("");
  }

  const highlightsHtml = advice.highlights?.length
    ? `<ul class="summary-list">` +
      advice.highlights
        .map((h) => `<li><strong>${escapeHtml(h.characteristic)}</strong> — ${escapeHtml(h.why)}</li>`)
        .join("") +
      `</ul>`
    : "";
  if (highlightsRoot) highlightsRoot.innerHTML = "";
  if (highlightsWhy) {
    highlightsWhy.innerHTML = highlightsHtml
      ? `<p class="section-label">Measurement flags</p>${highlightsHtml}`
      : "";
  }

  setHasResults(true);
  selectStage(0);
  setView("chain");
}

function showError(message, meta = null, opts = {}) {
  setProgress(false);
  lastAdvice = null;
  renderMaster(null);
  renderDesign(null);
  setHasResults(false);
  if (meta) showTrackCard(meta);
  showIdentity(Boolean(opts.needsIdentity), opts.prefill || "");
  if (emptyEl) {
    emptyEl.classList.remove("hidden");
    const kicker =
      opts.code === "no_preview"
        ? "No preview"
        : opts.needsIdentity
          ? "Confirm track"
          : "Couldn’t measure";
    const detail = opts.needsIdentity
      ? "Enter artist – song for a preview, or upload the file."
      : meta
        ? "Upload the audio file for this track to continue."
        : "Try another file or link.";
    emptyEl.innerHTML = `
      <p class="empty-kicker">${escapeHtml(kicker)}</p>
      <h2>${escapeHtml(message)}</h2>
      <p>${escapeHtml(detail)}</p>`;
  }
  if (consoleEl) consoleEl.textContent = message;
}

async function runAnalysis() {
  if (!lastSource || lastSource.kind === "blend") return;
  if (analyzing || blending) return;

  const needsCredit = shouldConsumeQuota;
  if (needsCredit) {
    const access = canAnalyze();
    if (!access.ok) {
      if (!getSession()) {
        applyAccessGate();
        return;
      }
      setStatus("idle", "Free analysis used");
      gateQuota?.classList.remove("hidden");
      return;
    }
  }

  if (analysisMode === "deep" && !canUseMode("deep").ok) {
    analysisMode = "standard";
    modeStandardBtn?.setAttribute("aria-pressed", "true");
    modeDeepBtn?.setAttribute("aria-pressed", "false");
    alert("Deep analysis is part of Pro — coming with paid plans.");
  }

  analyzing = true;
  const gen = ++analysisGen;
  const targetUpdateId = updatingEntryId;

  setHasResults(false);
  renderMaster(null);
  renderDesign(null);
  showIdentity(false);
  stopAudio();
  if (lastSource.kind === "file") {
    showTrackCard(null);
    lastTrackName = lastSource.file?.name?.replace(/\.[^.]+$/, "") || "";
  }
  if (emptyEl) {
    emptyEl.classList.remove("hidden");
    emptyEl.innerHTML = `
      <div data-analyze-hero aria-hidden="true"></div>
      <h2>${analysisMode === "deep" ? "Deep analysis…" : "Reading the vocal…"}</h2>
      <p>${
        analysisMode === "deep"
          ? "Measuring vocal + master bus to build a Pro chain."
          : "Measuring tone, dynamics, and stereo to build your chain."
      }</p>`;
    unmountHeroMark?.();
    unmountHeroMark = mountChainMark(emptyEl.querySelector("[data-analyze-hero]"), { variant: "cycle" });
  }

  const daw = "universal";
  setProgress(true, {
    label: lastSource.kind === "url" ? "Resolving link…" : "Loading audio…",
    progress: 0.04,
    stage: "loading",
  });
  setStatus("live", "Analyzing");

  const onProgress = (p) => {
    if (gen !== analysisGen) return;
    setProgress(true, p);
    setStatus("live", p.label);
  };

  try {
    if (!pluginMap) {
      pluginMap = await loadPluginMap();
    }

    const result =
      lastSource.kind === "url"
        ? await analyzeUrl(lastSource.url, {
            pluginMap,
            daw,
            mode: analysisMode,
            manualQuery: lastSource.manualQuery,
            onProgress,
          })
        : await analyzeFile(lastSource.file, { pluginMap, daw, mode: analysisMode, onProgress });

    if (gen !== analysisGen) return;

    // Mode re-run targeted an entry that was removed mid-flight — drop the result
    if (targetUpdateId && !library.get(targetUpdateId)) {
      updatingEntryId = null;
      setProgress(false);
      setStatus("idle", "Analysis discarded");
      return;
    }

    showTrackCard(result.source.meta);

    const name =
      result.source.meta?.matchedTitle && result.source.meta?.matchedArtist
        ? `${result.source.meta.matchedArtist} — ${result.source.meta.matchedTitle}`
        : result.source.name?.replace(/\.[^.]+$/, "") || lastTrackName || "Reference";

    const saved = {
      kind: "track",
      name,
      artwork: result.source.meta?.artwork || null,
      meta: result.source.meta || { title: name },
      source: lastSource,
      audioFile: result.file || (lastSource.kind === "file" ? lastSource.file : null),
      result: {
        readout: result.readout,
        traits: result.traits,
        advice: result.advice,
        mode: analysisMode,
      },
    };

    let entry;
    if (updatingEntryId && library.get(updatingEntryId)) {
      entry = library.update(updatingEntryId, saved);
      library.setActive(updatingEntryId);
    } else {
      entry = library.add(saved);
    }
    updatingEntryId = null;
    renderLibrary();
    applyEntryToStudio(entry);

    if (shouldConsumeQuota) {
      consumeAnalysis();
      shouldConsumeQuota = false;
      refreshQuotaChrome();
    }

    setProgress(true, { label: "Chain ready", progress: 1, stage: "done" });
    await new Promise((r) => setTimeout(r, 220));
    if (gen !== analysisGen) return;
    setProgress(false);
    console.log("[chainprint]", result);
  } catch (err) {
    if (gen !== analysisGen) return;
    console.error(err);
    setProgress(false);
    const needsIdentity = err.code === "needs_identity" || err.code === "oembed";
    showError(err.message || String(err), err.meta || null, {
      needsIdentity,
      code: err.code || "",
      prefill:
        err.meta?.title && err.meta?.artist
          ? `${err.meta.artist} – ${err.meta.title}`
          : err.meta?.title
            ? ` – ${err.meta.title}`
            : "",
    });
    setStatus("idle", needsIdentity ? "Confirm track" : "Failed");
  } finally {
    if (gen === analysisGen) analyzing = false;
  }
}

function beginNewSource(source) {
  if (analyzing || blending) return;
  if (!applyAccessGate()) return;
  lastSource = source;
  updatingEntryId = null;
  shouldConsumeQuota = true;
  runAnalysis();
}

if (dropzone && fileInput) {
  const openPicker = () => {
    if (analyzing || blending) return;
    fileInput.click();
  };
  dropzone.addEventListener("click", (e) => {
    if (e.target === fileInput || analyzing || blending) return;
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
    if (!analyzing && !blending) dropzone.classList.add("is-drag");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-drag");
    if (analyzing || blending) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    beginNewSource({ kind: "file", file });
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    beginNewSource({ kind: "file", file });
    fileInput.value = "";
  });
}

function submitUrl() {
  const url = urlInput?.value?.trim();
  if (!url) return;
  beginNewSource({ kind: "url", url });
}

function submitIdentity() {
  const url = urlInput?.value?.trim() || lastSource?.url;
  const manualQuery = identityInput?.value?.trim();
  if (!url || !manualQuery) return;
  beginNewSource({ kind: "url", url, manualQuery });
}

if (urlGo) urlGo.addEventListener("click", submitUrl);
if (urlInput) {
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitUrl();
    }
  });
}
if (identityGo) identityGo.addEventListener("click", submitIdentity);
if (identityInput) {
  identityInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitIdentity();
    }
  });
}

libraryList?.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-library-pick]");
  if (pick) {
    e.preventDefault();
    e.stopPropagation();
    library.toggleBlendPick(pick.getAttribute("data-library-pick"));
    renderLibrary();
    return;
  }
  const play = e.target.closest("[data-library-play]");
  if (play) {
    e.preventDefault();
    e.stopPropagation();
    const id = play.getAttribute("data-library-play");
    toggleEntryPlayback(library.get(id));
    return;
  }
  const remove = e.target.closest("[data-library-remove]");
  if (remove) {
    e.preventDefault();
    e.stopPropagation();
    if (analyzing || blending) return;
    const id = remove.getAttribute("data-library-remove");
    library.remove(id);
    const stillPlaying = playingKey();
    if (stillPlaying && !library.get(stillPlaying)) stopAudio();
    const next = library.active();
    renderLibrary();
    if (next?.result) applyEntryToStudio(next);
    else if (library.list().length) {
      const fallback = library.list().filter((e) => e.result).at(-1);
      if (fallback) {
        library.setActive(fallback.id);
        applyEntryToStudio(fallback);
        renderLibrary();
      } else {
        lastAdvice = null;
        lastSource = null;
        setHasResults(false);
        renderMaster(null);
        renderDesign(null);
        showTrackCard(null);
        setStatus("idle", "Waiting for a reference");
      }
    } else {
      lastAdvice = null;
      lastSource = null;
      setHasResults(false);
      renderMaster(null);
      renderDesign(null);
      showTrackCard(null);
      setStatus("idle", "Waiting for a reference");
    }
    return;
  }
  const select = e.target.closest("[data-library-select]");
  if (select) {
    selectLibraryEntry(select.getAttribute("data-library-select"));
  }
});

trackPlayBtn?.addEventListener("click", () => {
  toggleEntryPlayback(library.active());
});

blendWeightBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    blendWeight = Number(btn.getAttribute("data-blend-weight")) || 0.5;
    blendWeightBtns.forEach((b) => {
      const on = b === btn;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  });
});

blendGo?.addEventListener("click", () => {
  if (!applyAccessGate()) return;
  rebuildBlend();
});

renderLibrary();
setStatus("idle", "Waiting for a reference");
applyAccessGate();
setView("chain");
