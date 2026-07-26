/**
 * Analyze studio: source rail + focused chain stages (no long scroll dump).
 */

import { analyzeFile, analyzeUrl, formatReadoutConsole } from "../analyze.js";
import { loadPluginMap } from "../recommend.js";
import { getSession, initAuth, logout } from "../auth/session.js";
import {
  analysesRemaining,
  canAnalyze,
  canUseMode,
  consumeAnalysis,
  getPlan,
} from "../auth/quota.js";
import { createLibrary } from "../session/library.js";
import {
  deserializeEntry,
  deserializeStem,
  loadWorkspace,
  saveWorkspace,
  serializeEntry,
  serializeStem,
  workspaceKey,
} from "../session/library-persist.js";
import { blendTracks, blendReadouts } from "../blend.js";
import { mountAuthNav } from "./nav-auth.js";
import { renderPluginFace } from "./plugin-visuals.js";
import { mountChainMark } from "./chain-mark.js";
import { playAudio, stopAudio, subscribePlayback, playingKey, setChainFx, setChainPreview, isChainPreview } from "./audio-player.js";
import { mountPlaybackPulse } from "./playback-pulse.js";
import { setPlaybackTrackProvider, notifyPlaylist } from "./playback-playlist.js";
import { compareMixes } from "../match.js";
import { bindReadoutExplainers, readoutCardHtml } from "./readout-glossary.js";
import { glyphHtml, meterLevelForReadout } from "./studio-glyphs.js";
// PDF export + share are lazy-loaded on click so a CDN failure can't break the studio

const library = createLibrary({
  onChange() {
    if (persistReady) schedulePersist();
  },
});

/** Dry takes attached to a specific library reference id */
/** @type {Map<string, { vocal: File | null, instrumental: File | null }>} */
const dryByEntryId = new Map();

let persistReady = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let persistTimer = null;

function schedulePersist() {
  if (!persistReady) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistWorkspaceNow();
  }, 400);
}

async function persistWorkspaceNow() {
  try {
    const account = getSession();
    /** @type {Record<string, { dryVocal: ReturnType<typeof serializeStem>, dryInstrumental: ReturnType<typeof serializeStem> }>} */
    const dryByEntry = {};
    for (const [id, slot] of dryByEntryId) {
      if (!library.get(id)) continue;
      if (!slot.vocal && !slot.instrumental) continue;
      dryByEntry[id] = {
        dryVocal: serializeStem(slot.vocal),
        dryInstrumental: serializeStem(slot.instrumental),
      };
    }
    await saveWorkspace(workspaceKey(account?.id), {
      version: 2,
      activeId: library.active()?.id || null,
      analysisTarget,
      analysisMode,
      entries: library.list().map(serializeEntry),
      dryByEntry,
    });
  } catch (err) {
    console.warn("[chainprint] persist failed", err);
  }
}

/**
 * @returns {Promise<boolean>}
 */
async function restoreWorkspace() {
  const account = getSession();
  const key = workspaceKey(account?.id);
  let raw = await loadWorkspace(key);

  // First login on this browser — adopt any guest workspace
  if ((!raw || !raw.entries?.length) && account?.id) {
    const guest = await loadWorkspace(workspaceKey(null));
    if (guest?.entries?.length) {
      raw = guest;
      await saveWorkspace(key, guest);
    }
  }

  if (!raw || !Array.isArray(raw.entries) || !raw.entries.length) return false;

  const entries = raw.entries.map(deserializeEntry).filter(Boolean);
  if (!entries.length) return false;

  library.hydrate(entries, raw.activeId || null);

  dryByEntryId.clear();
  if (raw.dryByEntry && typeof raw.dryByEntry === "object") {
    for (const [id, slot] of Object.entries(raw.dryByEntry)) {
      if (!library.get(id) || !slot || typeof slot !== "object") continue;
      dryByEntryId.set(id, {
        vocal: deserializeStem(slot.dryVocal),
        instrumental: deserializeStem(slot.dryInstrumental),
      });
    }
  } else if (raw.dryVocal || raw.dryInstrumental) {
    // Migrate legacy global dry stems onto the active reference
    const attachId = raw.activeId && library.get(raw.activeId) ? raw.activeId : entries[0]?.id;
    if (attachId) {
      dryByEntryId.set(attachId, {
        vocal: deserializeStem(raw.dryVocal),
        instrumental: deserializeStem(raw.dryInstrumental),
      });
    }
  }

  if (raw.analysisTarget === "instrumental" || raw.analysisTarget === "full" || raw.analysisTarget === "vocal") {
    analysisTarget = raw.analysisTarget;
    targetVocalBtn?.setAttribute("aria-pressed", String(analysisTarget === "vocal"));
    targetInstrumentalBtn?.setAttribute("aria-pressed", String(analysisTarget === "instrumental"));
    targetFullBtn?.setAttribute("aria-pressed", String(analysisTarget === "full"));
  }
  if (raw.analysisMode === "standard" || raw.analysisMode === "deep") {
    analysisMode = raw.analysisMode === "deep" && canUseMode("deep").ok ? "deep" : "standard";
    modeStandardBtn?.setAttribute("aria-pressed", String(analysisMode === "standard"));
    modeDeepBtn?.setAttribute("aria-pressed", String(analysisMode === "deep"));
  }

  syncDryInputsFromActive();

  syncSignatureCopy();
  syncChainPreviewUi();
  return true;
}

setPlaybackTrackProvider(() => {
  const tracks = [];
  for (const entry of library.list()) {
    const file = audioFileForEntry(entry);
    if (file) {
      tracks.push({ id: entry.id, title: entryDisplayName(entry), file });
    }
    const stem = dryStemForEntry(entry.id);
    if (stem) {
      tracks.push({
        id: `${entry.id}:dry`,
        title: dryFileName(stem),
        file: stem,
      });
    }
  }
  return tracks;
});
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
const whyOrderRoot = document.querySelector("[data-why-order]");
const whyTipEl = document.querySelector("[data-why-tip]");
const whyIntentEl = document.querySelector("[data-why-intent]");
const honestyEl = document.querySelector("[data-honesty]");
const estimateNoteEl = document.querySelector("[data-estimate-note]");
const highlightsRoot = document.querySelector("[data-highlights]");
const highlightsWhy = document.querySelector("[data-highlights-why]");
const trackCard = document.querySelector("[data-track-card]");
const trackArt = document.querySelector("[data-track-art]");
const trackTitle = document.querySelector("[data-track-title]");
const trackMeta = document.querySelector("[data-track-meta]");
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
const targetVocalBtn = document.querySelector('[data-target="vocal"]');
const targetInstrumentalBtn = document.querySelector('[data-target="instrumental"]');
const targetFullBtn = document.querySelector('[data-target="full"]');
const stemVocalInput = document.querySelector("[data-stem-vocal]");
const stemInstrumentalInput = document.querySelector("[data-stem-instrumental]");
const stemVocalName = document.querySelector("[data-stem-vocal-name]");
const stemInstrumentalName = document.querySelector("[data-stem-instrumental-name]");
const instrumentsEmpty = document.querySelector("[data-instruments-empty]");
const instrumentsList = document.querySelector("[data-instruments-list]");
const signatureTitle = document.querySelector("[data-signature-title]");
const signatureSub = document.querySelector("[data-signature-sub]");
const emptyEl = document.querySelector("[data-empty]");
const chainWorkspace = document.querySelector("[data-chain-workspace]");
const stageRailShell = document.querySelector("[data-stage-rail-shell]");
const stageRailScroll = document.querySelector("[data-stage-rail-scroll]");
const stageRailMore = document.querySelector("[data-stage-rail-more]");
const stageRailInserts = document.querySelector("[data-stage-rail-inserts]");
const stageRailSends = document.querySelector("[data-stage-rail-sends]");
const stageFocus = document.querySelector("[data-stage-focus]");
const stageCount = document.querySelector("[data-stage-count]");
const stagePrev = document.querySelector("[data-stage-prev]");
const stageNext = document.querySelector("[data-stage-next]");
const exportPdfBtn = document.querySelector("[data-export-pdf]");
const exportAbletonBtn = document.querySelector("[data-export-ableton]");
const shareChainBtn = document.querySelector("[data-share-chain]");
const matchFileInput = document.querySelector("[data-match-file]");
const matchName = document.querySelector("[data-match-name]");
const matchStatus = document.querySelector("[data-match-status]");
const matchResults = document.querySelector("[data-match-results]");
const matchVerdict = document.querySelector("[data-match-verdict]");
const matchReadouts = document.querySelector("[data-match-readouts]");
const matchBandsRoot = document.querySelector("[data-match-bands]");
const matchMoves = document.querySelector("[data-match-moves]");
const matchNote = document.querySelector("[data-match-note]");
const previewDryBtn = document.querySelector('[data-preview-mode="dry"]');
const previewChainBtn = document.querySelector('[data-preview-mode="chain"]');
const previewHint = document.querySelector("[data-preview-hint]");
const hearFieldVocal = document.querySelector('[data-hear-field="vocal"]');
const hearFieldInstrumental = document.querySelector('[data-hear-field="instrumental"]');
const hearStepDry = document.querySelector("[data-hear-step-dry]");
const hearStepAb = document.querySelector("[data-hear-step-ab]");
const hearFileLabel = document.querySelector("[data-hear-file-label]");
const hearPickLabel = document.querySelector("[data-hear-pick-label]");
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
const designSub = document.querySelector("[data-design-sub]");
const designCues = document.querySelector("[data-design-cues]");
const designLayers = document.querySelector("[data-design-layers]");
const designChecklist = document.querySelector("[data-design-checklist]");
const designChecklistBlock = document.querySelector("[data-design-checklist-block]");
const libraryList = document.querySelector("[data-library-list]");
const libraryCount = document.querySelector("[data-library-count]");
const libraryHint = document.querySelector("[data-library-hint]");
const blendPanel = document.querySelector("[data-blend-panel]");
const blendToggle = document.querySelector("[data-blend-toggle]");
const blendToggleMeta = document.querySelector("[data-blend-toggle-meta]");
const blendSlotA = document.querySelector('[data-blend-slot="a"]');
const blendSlotB = document.querySelector('[data-blend-slot="b"]');
const blendDiff = document.querySelector("[data-blend-diff]");
const blendGo = document.querySelector("[data-blend-go]");
const blendWeightBtns = document.querySelectorAll("[data-blend-weight]");
const sourceCollapseBtn = document.querySelector("[data-source-collapse]");
const sourcePeekBtn = document.querySelector("[data-source-peek]");
const sourcePeekMeta = document.querySelector("[data-source-peek-meta]");
const SOURCE_COLLAPSE_KEY = "chainprint.sourceCollapsed";

let pluginMap = null;
/** @type {{ kind: 'file', file: File } | { kind: 'url', url: string, manualQuery?: string } | null} */
let lastSource = null;
let shouldConsumeQuota = false;
/** @type {'standard' | 'deep'} */
let analysisMode = "standard";
/** @type {'vocal' | 'instrumental' | 'full'} */
let analysisTarget = "vocal";
/** @type {object | null} */
let lastAdvice = null;
/** @type {string} */
let lastTrackName = "";
/** @type {Array<{ step: object, kind: 'insert' | 'send', index: number }>} */
let stages = [];
let stageIndex = 0;
/** @type {'chain' | 'signature' | 'compare' | 'why' | 'instruments' | 'design' | 'master'} */
let activeView = "chain";
/** @type {'design' | 'master' | null} */
let pendingViewAfterAnalysis = null;
/** @type {File | null} */
let matchFile = null;
let matchBusy = false;
/** Library entry id the current match report was computed against */
let matchEntryId = null;
/** @type {(() => void) | null} */
let unmountHeroMark = null;
let analyzing = false;
let analysisGen = 0;
let blending = false;
/** Merge panel open state — collapsed by default so it doesn’t eat the rail. */
let blendPanelOpen = false;

await initAuth();

mountAuthNav(document.querySelector("[data-auth-nav]"), {
  authHref: "../auth/",
  next: "/analyze/",
  settingsHref: "../settings/",
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
  syncDeepUnlockCtas(account);

  if (!account || !quotaBar) return;
  const plan = getPlan(account);
  const left = analysesRemaining(account);
  quotaBar.classList.remove("hidden");
  if (quotaLabel) quotaLabel.textContent = plan.label;
  if (quotaLeft) {
    quotaLeft.textContent = left === Infinity ? "Unlimited" : `${left} left`;
  }
}

function syncDeepUnlockCtas(account = getSession()) {
  const deep = canUseMode("deep", account);
  document.querySelectorAll("[data-unlock-deep]").forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (!deep.ok && deep.reason === "deep_locked") {
      btn.textContent = "Deep is Pro";
    } else {
      btn.textContent = "Run Deep analysis";
    }
  });
}

function applyAccessGate() {
  const account = getSession();
  // Keep the studio visible under the gate so DAW / layout stay discoverable
  workspace?.classList.remove("hidden");
  workspace?.removeAttribute("aria-hidden");

  if (!account) {
    gateAuth?.classList.remove("hidden");
    gateQuota?.classList.add("hidden");
    refreshQuotaChrome();
    return false;
  }

  gateAuth?.classList.add("hidden");
  refreshQuotaChrome();
  const access = canAnalyze(account);
  if (!access.ok) {
    gateQuota?.classList.remove("hidden");
    return false;
  }

  gateQuota?.classList.add("hidden");
  return true;
}

document.querySelector("[data-logout-gate]")?.addEventListener("click", async () => {
  try {
    await Promise.race([
      logout(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    /* still leave the page */
  }
  location.href = "../auth/?mode=login&next=/analyze/";
});

document.querySelector("[data-upgrade-soon]")?.addEventListener("click", () => {
  alert("Paid plans aren’t live yet — this is where upgrade / billing will land.");
});

function setMode(mode) {
  if (analyzing || blending) return;
  if (mode === "deep") {
    const deep = canUseMode("deep");
    if (!deep.ok) {
      if (deep.reason === "deep_locked") {
        alert("Deep analysis (Design & Master) is a Pro feature — paid plans aren’t live yet.");
      } else if (deep.reason === "auth") {
        location.href = "../auth/?mode=signup&next=/analyze/";
      } else if (deep.reason === "quota") {
        setStatus("idle", "Out of free analyses");
        gateQuota?.classList.remove("hidden");
      }
      return;
    }
  }
  const changed = analysisMode !== mode;
  analysisMode = mode;
  modeStandardBtn?.setAttribute("aria-pressed", String(mode === "standard"));
  modeDeepBtn?.setAttribute("aria-pressed", String(mode === "deep"));
  if (!changed) return;
  const started = rerunActiveAnalysis();
  if (!started && library.active()?.result) {
    setStatus(
      "idle",
      mode === "deep"
        ? "Deep selected — re-upload or re-link this reference to rebuild"
        : "Mode updated — re-upload or re-link to rebuild"
    );
  }
}

function setTarget(target) {
  if (analyzing || blending) return;
  const next =
    target === "instrumental" || target === "full" ? target : "vocal";
  const changed = analysisTarget !== next;
  analysisTarget = next;
  targetVocalBtn?.setAttribute("aria-pressed", String(next === "vocal"));
  targetInstrumentalBtn?.setAttribute("aria-pressed", String(next === "instrumental"));
  targetFullBtn?.setAttribute("aria-pressed", String(next === "full"));
  syncSignatureCopy();
  syncDryInputsFromActive();
  syncChainPreviewUi();
  renderLibrary();
  if (!changed) return;
  rerunActiveAnalysis();
}

/** @returns {boolean} whether an analysis was started */
function rerunActiveAnalysis() {
  const active = library.active();
  if (active?.kind === "blend" && active.blendOf?.length === 2) {
    rebuildBlend(active);
    return true;
  }

  const fromEntry = resolveRerunSource(active);
  if (fromEntry) {
    lastSource = fromEntry;
    updatingEntryId = active.id;
    shouldConsumeQuota = false;
    runAnalysis();
    return true;
  }

  if (lastSource && lastSource.kind !== "blend") {
    if (lastSource.kind === "file" && !(lastSource.file instanceof Blob)) {
      setStatus("idle", "Reference file missing — upload it again to re-run");
      return false;
    }
    shouldConsumeQuota = false;
    runAnalysis();
    return true;
  }

  return false;
}

/**
 * Prefer live source; fall back to persisted audio blob when file source was lost.
 * @param {import('../session/library.js').LibraryEntry | null | undefined} entry
 */
function resolveRerunSource(entry) {
  if (!entry) return null;
  if (entry.source?.kind === "url" && entry.source.url) {
    return {
      kind: "url",
      url: entry.source.url,
      manualQuery: entry.source.manualQuery,
    };
  }
  if (entry.source?.kind === "file" && entry.source.file instanceof Blob) {
    return { kind: "file", file: entry.source.file };
  }
  if (entry.audioFile instanceof Blob) {
    const file =
      entry.audioFile instanceof File
        ? entry.audioFile
        : new File([entry.audioFile], `${entry.name || "reference"}.wav`, {
            type: entry.audioFile.type || "audio/wav",
          });
    return { kind: "file", file };
  }
  return null;
}

function syncSignatureCopy() {
  if (signatureTitle) {
    signatureTitle.textContent =
      analysisTarget === "instrumental"
        ? "Instrumental signature"
        : analysisTarget === "full"
          ? "Full-mix signature"
          : "Vocal signature";
  }
  if (signatureSub) {
    signatureSub.textContent =
      analysisTarget === "instrumental"
        ? "Measured from the instrumental bed — what dialed every stage. Tap any box for a plain-English definition."
        : analysisTarget === "full"
          ? "Measured from the full mix — mix-bus balance and dynamics. Tap any box for a plain-English definition."
          : "Measured from the vocal region — what dialed every stage. Tap any box for a plain-English definition.";
  }
}

modeStandardBtn?.addEventListener("click", () => setMode("standard"));
modeDeepBtn?.addEventListener("click", () => setMode("deep"));
targetVocalBtn?.addEventListener("click", () => setTarget("vocal"));
targetInstrumentalBtn?.addEventListener("click", () => setTarget("instrumental"));
targetFullBtn?.addEventListener("click", () => setTarget("full"));

{
  const prefs = getSession();
  const preferredMode = prefs?.defaultMode === "deep" && canUseMode("deep", prefs).ok ? "deep" : "standard";
  const preferredTarget =
    prefs?.defaultTarget === "instrumental" || prefs?.defaultTarget === "full"
      ? prefs.defaultTarget
      : "vocal";
  setMode(preferredMode);
  setTarget(preferredTarget);
}

stemVocalInput?.addEventListener("change", () => {
  const active = library.active();
  if (!active) {
    if (stemVocalInput) stemVocalInput.value = "";
    setStatus("idle", "Select a reference before adding a dry take");
    return;
  }
  const file = stemVocalInput.files?.[0] || null;
  const slot = ensureDrySlot(active.id);
  slot.vocal = file;
  if (stemVocalName) stemVocalName.textContent = file?.name || "No file yet";
  // Dry take is preview-only — never re-analyze / rename the reference
  syncChainPreviewUi();
  renderLibrary();
  schedulePersist();
});
stemInstrumentalInput?.addEventListener("change", () => {
  const active = library.active();
  if (!active) {
    if (stemInstrumentalInput) stemInstrumentalInput.value = "";
    setStatus("idle", "Select a reference before adding a dry take");
    return;
  }
  const file = stemInstrumentalInput.files?.[0] || null;
  const slot = ensureDrySlot(active.id);
  slot.instrumental = file;
  if (stemInstrumentalName) stemInstrumentalName.textContent = file?.name || "No file yet";
  syncChainPreviewUi();
  renderLibrary();
  schedulePersist();
});

function setView(view) {
  if (!lastAdvice && view !== "chain") return;
  activeView = view;
  viewTabs.forEach((tab) => {
    const v = tab.getAttribute("data-view");
    tab.setAttribute("aria-pressed", String(v === view));
  });
  panels.forEach((panel) => {
    const on = panel.getAttribute("data-panel") === view;
    panel.classList.toggle("is-active", on);
    panel.classList.toggle("is-entering", on);
  });
}

function readoutHtml(key, value, sub, i = 0) {
  return readoutCardHtml(key, value, String(sub || "").replace(/_/g, " "), escapeHtml, {
    meter: meterLevelForReadout(key, value, sub),
    glyph: glyphHtml(key),
  }).replace('class="readout', `style="--i:${i}" class="readout`);
}

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const v = tab.getAttribute("data-view");
    if (!v || tab.disabled) return;
    setView(
      /** @type {'chain' | 'signature' | 'compare' | 'why' | 'instruments' | 'design' | 'master'} */ (v)
    );
  });
});

document.querySelectorAll("[data-unlock-deep]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const deep = canUseMode("deep");
    if (!deep.ok) {
      if (deep.reason === "deep_locked") {
        alert("Deep analysis (Design & Master) is a Pro feature — paid plans aren’t live yet.");
        return;
      }
      if (deep.reason === "auth") {
        location.href = "../auth/?mode=signup&next=/analyze/";
        return;
      }
      alert("You’re out of free analyses for now.");
      return;
    }
    const nextView = btn.getAttribute("data-unlock-deep");
    if (nextView === "design" || nextView === "master") {
      pendingViewAfterAnalysis = nextView;
    }
    if (analysisMode !== "deep") {
      setMode("deep");
      if (analysisMode !== "deep") pendingViewAfterAnalysis = null;
      // setMode already re-runs when the mode changes
      return;
    }
    if (!rerunActiveAnalysis()) {
      setStatus("idle", "Re-upload or re-link this reference to run Deep");
      pendingViewAfterAnalysis = null;
    }
  });
});

function setStatus(state, text) {
  if (lampIdle) lampIdle.dataset.state = state;
  if (statusText) statusText.textContent = text;
}

function ensureDrySlot(entryId) {
  let slot = dryByEntryId.get(entryId);
  if (!slot) {
    slot = { vocal: null, instrumental: null };
    dryByEntryId.set(entryId, slot);
  }
  return slot;
}

function dryStemForEntry(entryId) {
  if (!entryId) return null;
  const slot = dryByEntryId.get(entryId);
  if (!slot) return null;
  if (analysisTarget === "vocal") return slot.vocal;
  if (analysisTarget === "instrumental") return slot.instrumental;
  return slot.vocal || slot.instrumental || null;
}

function dryPreviewStem() {
  return dryStemForEntry(library.active()?.id);
}

function syncDryInputsFromActive() {
  const slot = library.active() ? dryByEntryId.get(library.active().id) : null;
  if (stemVocalInput) stemVocalInput.value = "";
  if (stemInstrumentalInput) stemInstrumentalInput.value = "";
  if (stemVocalName) stemVocalName.textContent = slot?.vocal?.name || "No file yet";
  if (stemInstrumentalName) {
    stemInstrumentalName.textContent = slot?.instrumental?.name || "No file yet";
  }
}

function syncHearStripFields() {
  const wantInstrumental = analysisTarget === "instrumental";
  if (hearFieldVocal) hearFieldVocal.hidden = wantInstrumental;
  if (hearFieldInstrumental) hearFieldInstrumental.hidden = !wantInstrumental;

  if (hearFileLabel) {
    hearFileLabel.textContent =
      analysisTarget === "full" ? "Your dry take" : "Your dry vocal";
  }
  if (hearPickLabel) {
    hearPickLabel.textContent =
      analysisTarget === "full"
        ? "Add dry take"
        : analysisTarget === "instrumental"
          ? "Add dry instrumental"
          : "Add dry vocal";
  }
}

function syncChainPreviewUi() {
  syncHearStripFields();
  const hasChain = Boolean(lastAdvice?.chain);
  const stem = dryPreviewStem();
  const canPreview = hasChain && Boolean(stem);

  if (previewDryBtn) previewDryBtn.disabled = !canPreview;
  if (previewChainBtn) previewChainBtn.disabled = !canPreview;

  if (!canPreview && isChainPreview()) {
    setChainPreview(false);
  }

  const previewOn = isChainPreview();
  previewDryBtn?.setAttribute("aria-pressed", String(canPreview && !previewOn));
  previewChainBtn?.setAttribute("aria-pressed", String(canPreview && previewOn));

  hearStepDry?.classList.toggle("is-ready", Boolean(stem));
  hearStepDry?.classList.toggle("is-active", hasChain && !stem);
  hearStepAb?.classList.toggle("is-ready", canPreview);
  hearStepAb?.classList.toggle("is-active", canPreview && previewOn);

  if (previewHint) {
    if (!hasChain) {
      previewHint.textContent = "Analyze a reference first";
    } else if (!stem) {
      previewHint.textContent =
        analysisTarget === "instrumental"
          ? "Add your dry instrumental to compare"
          : analysisTarget === "full"
            ? "Add a dry take to compare"
            : "Add your dry vocal to compare";
    } else if (previewOn) {
      previewHint.textContent = "Hearing through chain";
    } else {
      previewHint.textContent = "Hearing dry — switch to Through chain";
    }
  }
}

function audioFileForEntry(entry) {
  if (!entry) return null;
  if (entry.audioFile instanceof Blob) return entry.audioFile;
  if (entry.source?.kind === "file" && entry.source.file instanceof Blob) return entry.source.file;
  return null;
}

function applyChainFxFromAdvice(advice) {
  const chain = advice?.chain || null;
  setChainFx(chain);
  if (!chain || !dryPreviewStem()) setChainPreview(false);
  syncChainPreviewUi();
}

function syncPlayButtons() {
  const key = playingKey();
  libraryList?.querySelectorAll("[data-library-play]").forEach((btn) => {
    const id = btn.getAttribute("data-library-play");
    const on = key === id;
    btn.classList.toggle("is-playing", on);
    btn.setAttribute("aria-label", on ? "Pause" : "Play");
  });
}

function dryRoleLabel() {
  if (analysisTarget === "instrumental") return "Dry instrumental";
  if (analysisTarget === "full") return "Dry take";
  return "Dry vocal";
}

function dryFileName(file) {
  return file?.name?.replace(/\.[^.]+$/, "") || dryRoleLabel();
}

async function toggleDryPlayback() {
  const stem = dryPreviewStem();
  if (!stem) return;
  const entry = library.active();
  const key = entry ? `${entry.id}:dry` : "dry-preview";
  // Keep current dry/chain mode when re-toggling from the library row
  const wantChain = isChainPreview() && Boolean(lastAdvice?.chain);
  setChainPreview(wantChain);
  syncChainPreviewUi();
  try {
    await playAudio(stem, key, {
      title: wantChain ? `${dryFileName(stem)} · through chain` : dryFileName(stem),
    });
  } catch (err) {
    console.error(err);
    setStatus("idle", "Couldn’t play your dry take");
  }
}

function clearDryStem(entryId = library.active()?.id) {
  if (!entryId) return;
  dryByEntryId.delete(entryId);
  if (library.active()?.id === entryId) {
    if (stemVocalInput) stemVocalInput.value = "";
    if (stemInstrumentalInput) stemInstrumentalInput.value = "";
    if (stemVocalName) stemVocalName.textContent = "No file yet";
    if (stemInstrumentalName) stemInstrumentalName.textContent = "No file yet";
    setChainPreview(false);
  }
  syncChainPreviewUi();
  renderLibrary();
  schedulePersist();
  const key = playingKey();
  if (key === `${entryId}:dry`) stopAudio();
}

async function toggleEntryPlayback(entry) {
  const file = audioFileForEntry(entry);
  if (!file || !entry) return;
  // Library play is always the mixed reference — never chain-preview on it
  setChainPreview(false);
  syncChainPreviewUi();
  try {
    await playAudio(file, entry.id, { title: entryDisplayName(entry) });
  } catch (err) {
    console.error(err);
    setStatus("idle", "Couldn’t play this reference");
  }
}

async function setPreviewMode(mode) {
  if (!lastAdvice?.chain) return;
  const stem = dryPreviewStem();
  if (!stem) {
    syncChainPreviewUi();
    const field =
      analysisTarget === "instrumental" ? hearFieldInstrumental : hearFieldVocal;
    field?.querySelector(".stem-pick-btn")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setStatus("idle", "Add your dry take to hear this chain");
    return;
  }

  const wantChain = mode === "chain";
  setChainPreview(wantChain);
  syncChainPreviewUi();

  const entry = library.active();
  const titleBase = dryFileName(stem);
  try {
    await playAudio(stem, entry ? `${entry.id}:dry` : "dry-preview", {
      title: wantChain ? `${titleBase} · through chain` : titleBase,
    });
  } catch (err) {
    console.warn("[preview] dry take play failed", err);
    setStatus("idle", "Couldn’t play your dry take");
  }
}

previewDryBtn?.addEventListener("click", () => setPreviewMode("dry"));
previewChainBtn?.addEventListener("click", () => setPreviewMode("chain"));

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
  targetVocalBtn && (targetVocalBtn.disabled = on || blending);
  targetInstrumentalBtn && (targetInstrumentalBtn.disabled = on || blending);
  targetFullBtn && (targetFullBtn.disabled = on || blending);
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
  // Library row is the canonical identity once a ref is saved — avoid a second card
  if (!meta || library.list().length > 0) {
    trackCard.classList.add("hidden");
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
}

function entryDisplayName(entry) {
  return entry.name || "Reference";
}

function renderLibrary() {
  const entries = library.list();
  const active = library.active();
  const picks = new Set(library.blendPicks().map((e) => e.id));
  const dryAttached = entries.filter((e) => dryStemForEntry(e.id)).length;

  if (libraryCount) {
    libraryCount.textContent = String(entries.length + dryAttached);
  }
  syncSourcePeek();

  if (libraryList) {
    const pickOrder = library.blendPicks().map((e) => e.id);
    const rows = [];

    for (const entry of entries) {
      const isActive = active?.id === entry.id;
      const picked = picks.has(entry.id);
      const pickLetter = picked ? (pickOrder[0] === entry.id ? "A" : "B") : "";
      const canPick = entry.kind === "track" && entry.result;
      const art = entry.artwork
        ? `<img class="library-item-art" src="${escapeHtml(entry.artwork)}" alt="" />`
        : "";
      const meta =
        entry.kind === "blend"
          ? "Combination mix"
          : entry.result
            ? entry.result.mode === "deep"
              ? "Reference · Deep"
              : "Reference"
            : "Analyzing…";
      const canPlay = Boolean(audioFileForEntry(entry));
      rows.push(`
        <li>
          <div class="library-item ${isActive ? "is-active" : ""}" data-library-id="${escapeHtml(entry.id)}">
            ${
              canPick
                ? `<button type="button" class="library-check ${picked ? "is-on" : ""}" data-library-pick="${escapeHtml(entry.id)}" aria-label="${picked ? `Merge pick ${pickLetter}` : "Select for merge"}" aria-pressed="${picked}">${pickLetter}</button>`
                : `<span class="library-check" style="opacity:0;pointer-events:none"></span>`
            }
            <button type="button" class="library-item-main ${art ? "has-art" : ""}" data-library-select="${escapeHtml(entry.id)}">
              ${art}
              <span class="library-item-copy">
                <span class="library-item-title">${escapeHtml(entryDisplayName(entry))}</span>
                <span class="library-item-meta">${escapeHtml(meta)}</span>
              </span>
            </button>
            <div class="library-item-actions">
              <div class="library-item-btns">
              ${
                canPlay
                  ? `<button type="button" class="library-item-play" data-library-play="${escapeHtml(entry.id)}" aria-label="Play reference"><span class="library-item-play-icon" aria-hidden="true"></span></button>`
                  : ""
              }
              <button type="button" class="library-item-remove" data-library-remove="${escapeHtml(entry.id)}" aria-label="Remove">×</button>
              </div>
              <span class="library-item-kind is-ref" title="Reference" aria-label="Reference"></span>
            </div>
          </div>
        </li>`);

      const stem = dryStemForEntry(entry.id);
      if (stem) {
        const dryKey = `${entry.id}:dry`;
        rows.push(`
        <li>
          <div class="library-item is-dry ${playingKey() === dryKey ? "is-playing-row" : ""}" data-dry-row data-dry-for="${escapeHtml(entry.id)}">
            <span class="library-check" style="opacity:0;pointer-events:none"></span>
            <button type="button" class="library-item-main" data-dry-select>
              <span class="library-item-copy">
                <span class="library-item-title">${escapeHtml(dryFileName(stem))}</span>
                <span class="library-item-meta">${escapeHtml(dryRoleLabel())} · for chain preview</span>
              </span>
            </button>
            <div class="library-item-actions">
              <div class="library-item-btns">
                <button type="button" class="library-item-play" data-library-play="${escapeHtml(dryKey)}" data-dry-play aria-label="Play dry take"><span class="library-item-play-icon" aria-hidden="true"></span></button>
                <button type="button" class="library-item-remove" data-dry-remove aria-label="Remove dry take">×</button>
              </div>
              <span class="library-item-kind is-dry" title="Dry take" aria-label="Dry take"></span>
            </div>
          </div>
        </li>`);
      }
    }

    libraryList.innerHTML = rows.join("");
  }

  const trackCount = entries.filter((e) => e.kind === "track" && e.result).length;
  blendPanel?.classList.toggle("hidden", trackCount < 2);
  blendPanel?.classList.toggle("is-collapsed", !blendPanelOpen);
  if (blendToggle) blendToggle.setAttribute("aria-expanded", blendPanelOpen ? "true" : "false");

  const [a, b] = library.blendPicks();
  const pickCount = [a, b].filter(Boolean).length;
  if (blendToggleMeta) blendToggleMeta.textContent = `${pickCount}/2`;
  if (blendSlotA) {
    blendSlotA.textContent = a ? `A · ${entryDisplayName(a)}` : "A · check a ref";
    blendSlotA.classList.toggle("is-filled", Boolean(a));
  }
  if (blendSlotB) {
    blendSlotB.textContent = b ? `B · ${entryDisplayName(b)}` : "B · check a ref";
    blendSlotB.classList.toggle("is-filled", Boolean(b));
  }
  if (blendGo) blendGo.disabled = !library.canBlend();
  renderBlendDiffPreview(a, b);

  if (libraryHint) {
    if (!entries.length) {
      libraryHint.textContent = "Load a reference to start.";
      libraryHint.classList.remove("is-ready", "hidden");
    } else {
      libraryHint.textContent = "";
      libraryHint.classList.add("hidden");
    }
  }

  syncPlayButtons();
  notifyPlaylist();
  if (library.list().length > 0) trackCard?.classList.add("hidden");
}

function applyEntryToStudio(entry) {
  if (!entry?.result) {
    setHasResults(false);
    renderMaster(null);
    renderDesign(null);
    renderInstruments(null);
    return;
  }
  // Keep the reference rail reachable on mobile (uploads / library / play)
  // Collapse is still available via the header chevron if they want more Chain room.
  const { result } = entry;
  lastAdvice = result.advice || null;
  if (result.target) analysisTarget = result.target;
  else if (result.advice?.target) analysisTarget = result.advice.target;
  if (result.mode === "standard" || result.mode === "deep") {
    analysisMode = result.mode;
  } else if (result.advice?.mode === "standard" || result.advice?.mode === "deep") {
    analysisMode = result.advice.mode;
  }
  targetVocalBtn?.setAttribute("aria-pressed", String(analysisTarget === "vocal"));
  targetInstrumentalBtn?.setAttribute("aria-pressed", String(analysisTarget === "instrumental"));
  targetFullBtn?.setAttribute("aria-pressed", String(analysisTarget === "full"));
  modeStandardBtn?.setAttribute("aria-pressed", String(analysisMode === "standard"));
  modeDeepBtn?.setAttribute("aria-pressed", String(analysisMode === "deep"));
  syncSignatureCopy();
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
  renderInstruments(result.advice?.instruments || result.readout?.instruments || []);
  renderSummary(result.traits, result.advice);
  renderReadouts(result.readout, result.traits);
  renderBands(result.readout.bands);
  if (consoleEl) {
    consoleEl.textContent = formatReadoutConsole({
      source: { name: entry.name, origin: entry.kind, meta: entry.meta },
      readout: result.readout,
      traits: result.traits,
      advice: result.advice,
      target: result.target || analysisTarget,
    });
  }

  if (estimateNoteEl) {
    estimateNoteEl.textContent =
      entry.kind === "blend"
        ? "Exports an Ableton rack from this hybrid — settings blended from both references."
        : "Exports an Ableton rack with settings dialed from this reference.";
  }

  setHasResults(true);
  applyChainFxFromAdvice(lastAdvice);
  setStatus("live", entry.kind === "blend" ? "Hybrid chain ready" : "Chain ready");
  syncMatchToActiveEntry();
}

/** Live blend preview — mix % toward A/B, plus what that lean moves. */
function renderBlendDiffPreview(entryA, entryB) {
  if (!blendDiff) return;
  if (!entryA?.result?.readout || !entryB?.result?.readout) {
    blendDiff.classList.add("hidden");
    blendDiff.innerHTML = "";
    return;
  }

  const target = analysisTarget || entryA.result.readout.target || "vocal";
  const readoutA = entryA.result.readout;
  const readoutB = entryB.result.readout;
  const pctA = Math.round((1 - blendWeight) * 100);
  const pctB = Math.round(blendWeight * 100);
  const lean = blendWeight < 0.4 ? "a" : blendWeight > 0.6 ? "b" : "balanced";
  const mixLine = `${pctA}% A · ${pctB}% B`;

  let report;
  let shiftHint;

  if (lean === "balanced") {
    report = compareMixes(readoutA, readoutB, { target });
    shiftHint = "Where A and B differ";
  } else {
    const hybrid = blendReadouts(readoutA, readoutB, blendWeight);
    const balanced = blendReadouts(readoutA, readoutB, 0.5);
    report = compareMixes(balanced, hybrid, { target });
    shiftHint =
      lean === "a"
        ? `Pulls ${pctA - 50}% further toward A vs a 50/50 merge`
        : `Pulls ${pctB - 50}% further toward B vs a 50/50 merge`;
  }

  const chips = (report.metrics || [])
    .filter((m) => m.sign !== 0)
    .slice(0, 5)
    .map(
      (m) =>
        `<span class="blend-diff-chip"><em>${escapeHtml(m.key)}</em> ${escapeHtml(m.value)}</span>`
    );
  const bandThresh = lean === "balanced" ? 1.5 : 0.8;
  const bandGaps = (report.bands || [])
    .filter((b) => Math.abs(b.deltaDb) >= bandThresh)
    .sort((x, y) => Math.abs(y.deltaDb) - Math.abs(x.deltaDb))
    .slice(0, 3)
    .map((b) => {
      const sign = b.deltaDb > 0 ? "+" : "";
      return `<span class="blend-diff-chip"><em>${escapeHtml(b.label)}</em> ${sign}${b.deltaDb.toFixed(1)} dB</span>`;
    });
  const items = [...chips, ...bandGaps];

  const head = `<p class="blend-diff-mix">${escapeHtml(mixLine)}</p>
    <p class="blend-diff-label">${escapeHtml(shiftHint)}</p>`;

  if (!items.length) {
    const empty =
      lean === "balanced"
        ? "A and B already match closely — the hybrid won’t invent big differences."
        : lean === "a"
          ? "A and B are already close — leaning to A barely moves measured traits."
          : "A and B are already close — leaning to B barely moves measured traits.";
    blendDiff.innerHTML = `${head}<p class="blend-diff-empty">${escapeHtml(empty)}</p>`;
  } else {
    blendDiff.innerHTML = `${head}<div class="blend-diff-chips">${items.join("")}</div>`;
  }
  blendDiff.classList.remove("hidden");
}

function selectLibraryEntry(id) {
  const entry = library.setActive(id);
  if (!entry) return;
  syncDryInputsFromActive();
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

  setProgress(true, { label: "Merging signatures…", progress: 0.4, stage: "building" });
  setStatus("live", "Building hybrid");

  try {
    const weight = existing?.weight ?? blendWeight;
    const blended = blendTracks(a, b, {
      weight,
      pluginMap,
      mode: analysisMode,
      target: analysisTarget,
    });
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

    blendPanelOpen = false;
    renderLibrary();
    applyEntryToStudio(entry);
    setProgress(false);
    setStatus("live", "Hybrid chain ready");
  } catch (err) {
    console.error(err);
    setProgress(false);
    alert(err.message || "Could not merge those mixes.");
    setStatus("idle", "Merge failed");
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
  if (exportAbletonBtn) exportAbletonBtn.disabled = !on || !lastAdvice?.chain;
  if (!on) {
    applyChainFxFromAdvice(null);
  } else {
    applyChainFxFromAdvice(lastAdvice);
  }
  viewTabs.forEach((tab) => {
    const v = tab.getAttribute("data-view");
    if (v === "chain") return;
    // All result tabs stay clickable after analysis — Design/Master show a Deep CTA when empty
    tab.disabled = !on;
    if (v === "design" || v === "master") {
      const unlocked =
        v === "design" ? Boolean(lastAdvice?.design) : Boolean(lastAdvice?.master);
      tab.classList.toggle("is-locked-feature", on && !unlocked);
    } else {
      tab.classList.remove("is-locked-feature");
    }
  });
  if (!on) setView("chain");
}

// ---------------------------------------------------------------------------
// Compare — diff the user's mix against the active reference
// ---------------------------------------------------------------------------

function setMatchStatus(text) {
  if (!matchStatus) return;
  matchStatus.textContent = text || "";
  matchStatus.classList.toggle("hidden", !text);
}

function resetMatchReport() {
  matchEntryId = null;
  matchResults?.classList.add("hidden");
  setMatchStatus("");
}

/** Reference changed → the old diff is stale. Re-run if a mix is loaded. */
function syncMatchToActiveEntry() {
  const activeId = library.active()?.id || null;
  if (matchEntryId && matchEntryId !== activeId) {
    resetMatchReport();
    if (matchFile) runMatchAnalysis();
  }
}

async function runMatchAnalysis() {
  const entry = library.active();
  const refReadout = entry?.result?.readout;
  if (!matchFile || !refReadout || matchBusy) return;

  matchBusy = true;
  matchResults?.classList.add("hidden");
  setMatchStatus("Reading your mix…");
  try {
    const target = entry.result.target || analysisTarget;
    // The user's own mix — analyzed with the same target so signatures line up.
    // No pluginMap: we only need the readout, not a recommended chain.
    // Deliberately does not consume analysis quota.
    const res = await analyzeFile(matchFile, {
      mode: "standard",
      target,
      onProgress: ({ label, progress }) => {
        const pct = Math.round((progress || 0) * 100);
        setMatchStatus(`${label || "Analyzing your mix"} · ${pct}%`);
      },
    });
    matchEntryId = entry.id;
    renderMatchReport(compareMixes(refReadout, res.readout, { target }));
    setMatchStatus("");
  } catch (err) {
    console.error(err);
    setMatchStatus(err.message || "Could not analyze that file — try a WAV or MP3.");
  } finally {
    matchBusy = false;
  }
}

/** @param {import("../match.js").MatchReport} report */
function renderMatchReport(report) {
  if (!matchResults) return;
  matchResults.classList.remove("hidden");
  if (matchVerdict) matchVerdict.textContent = report.verdict;

  if (matchReadouts) {
    matchReadouts.innerHTML = report.metrics
      .map((m) =>
        readoutCardHtml(m.key, m.value, m.sub, escapeHtml, {
          className: m.sign === 0 ? "is-matched" : "",
          meter: meterLevelForReadout(m.key, m.value, m.sub),
          glyph: glyphHtml(m.key),
        })
      )
      .join("");
  }

  if (matchBandsRoot) {
    const maxDb = Math.max(3, ...report.bands.map((b) => Math.abs(b.deltaDb)));
    matchBandsRoot.innerHTML = report.bands
      .map((b) => {
        const pct = (Math.min(1, Math.abs(b.deltaDb) / maxDb) * 50).toFixed(1);
        const pos = b.deltaDb >= 0;
        const style = pos ? `left:50%;width:${pct}%` : `right:50%;width:${pct}%`;
        return `
        <div class="match-band-row" title="${escapeHtml(b.label)} · ${b.lo}–${b.hi} Hz · ${
          pos ? "your mix heavier than reference" : "reference heavier than your mix"
        }">
          <span class="name">${escapeHtml(b.label)}</span>
          <div class="match-band-track" role="img" aria-label="${escapeHtml(b.label)}: ${
            pos ? "your mix" : "reference"
          } heavier by ${Math.abs(b.deltaDb).toFixed(1)} dB">
            <span class="match-band-fill ${pos ? "is-pos" : "is-neg"}" style="${style}"></span>
          </div>
          <span class="db ${pos ? "is-pos" : "is-neg"}">${pos ? "+" : ""}${b.deltaDb.toFixed(1)}</span>
        </div>`;
      })
      .join("");
  }

  if (matchMoves) {
    matchMoves.innerHTML = report.moves.length
      ? report.moves
          .map(
            (m) => `
            <li>
              <strong>${escapeHtml(m.title)}</strong>
              <span>${escapeHtml(m.detail)}</span>
            </li>`
          )
          .join("")
      : `<li><strong>No big moves needed</strong><span>Your mix tracks the reference within tolerance on every axis measured.</span></li>`;
  }

  if (matchNote) {
    matchNote.textContent = report.note || "";
    matchNote.classList.toggle("hidden", !report.note);
  }
}

matchFileInput?.addEventListener("change", () => {
  matchFile = matchFileInput.files?.[0] || null;
  if (matchName) matchName.textContent = matchFile?.name || "No file yet";
  if (matchFile) runMatchAnalysis();
  else resetMatchReport();
});

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
    [
      "Centroid",
      `${readout.centroidHz.toFixed(0)} Hz`,
      readout.target === "full"
        ? "full mix"
        : readout.target === "instrumental"
          ? "instrumental-weighted"
          : "vocal-weighted",
    ],
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
  // Pretty-print categorical subs (e.g. heavily_limited → heavily limited)
  readoutRoot.innerHTML = items
    .map(([key, value, sub], i) => readoutHtml(key, value, sub, i))
    .join("");
}

function renderDesign(design) {
  const has = Boolean(design);
  designEmpty?.classList.toggle("hidden", has);
  designBody?.classList.toggle("hidden", !has);
  if (!has || !design) return;

  if (designHeadline) designHeadline.textContent = design.headline || "Production plan";
  if (designBlurb) designBlurb.textContent = design.blurb || "";
  if (designSub) {
    designSub.textContent =
      analysisTarget === "instrumental"
        ? "How to build atmosphere and production around the instrumental bed."
        : analysisTarget === "full"
          ? "How to shape arrangement, space, and print for the full mix."
          : "How to build the atmosphere and production around the dry vocal.";
  }

  if (designCues) {
    const cues = design.cues || [];
    designCues.innerHTML = cues.length
      ? cues
          .map(
            (c) => `
            <li class="design-cue">
              <span class="design-cue-label">${escapeHtml(c.label)}</span>
              <span class="design-cue-text">${escapeHtml(c.text)}</span>
            </li>`
          )
          .join("")
      : "";
    designCues.classList.toggle("hidden", !cues.length);
  }

  if (designLayers) {
    designLayers.innerHTML = (design.layers || [])
      .map((layer, i) => {
        const actions = layer.actions || layer.moves || [];
        const actionHtml = actions
          .map((m) => `<li>${escapeHtml(m)}</li>`)
          .join("");
        const tools = layer.tools || [];
        const toolsHtml = tools.length
          ? `<details class="design-tools">
              <summary>Plugin ideas <span class="design-tools-count">${tools.length}</span></summary>
              <div class="pro-picks">
                ${tools
                  .map(
                    (a) => `
                  <div class="pro-pick">
                    <div class="pro-pick-copy">
                      <p class="pro-pick-name">${escapeHtml(a.name)}</p>
                      <p class="pro-pick-meta">${escapeHtml(a.brand)} · ${escapeHtml(a.role)}</p>
                      <p class="pro-pick-why">${escapeHtml(a.why)}</p>
                    </div>
                    <a class="pro-pick-buy" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer sponsored">View deal</a>
                    <p class="pro-pick-note">Affiliate link · we may earn a commission</p>
                  </div>`
                  )
                  .join("")}
              </div>
            </details>`
          : "";
        return `
          <article class="design-layer" style="--i:${i}">
            <header class="design-layer-head">
              <span class="design-step" aria-hidden="true">
                <span class="design-step-glyph">${glyphHtml(layer.title || "layer")}</span>
                <span class="design-step-n">${i + 1}</span>
              </span>
              <div class="design-layer-copy">
                <h3>${escapeHtml(layer.title)}</h3>
                <p class="design-goal"><span class="design-goal-label">Goal</span> ${escapeHtml(
                  layer.goal || layer.intent || ""
                )}</p>
              </div>
            </header>
            ${
              actionHtml
                ? `<div class="design-actions-wrap">
                    <p class="design-actions-label">Do this</p>
                    <ol class="design-actions">${actionHtml}</ol>
                  </div>`
                : ""
            }
            ${toolsHtml}
          </article>`;
      })
      .join("");
  }

  if (designChecklist) {
    const checks = design.checklist || [];
    designChecklist.innerHTML = checks.map((c) => `<li>${escapeHtml(c)}</li>`).join("");
    designChecklistBlock?.classList.toggle("hidden", !checks.length);
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
      .map(([key, value, sub], i) => readoutHtml(key, value, sub, i))
      .join("");
  }
  if (masterNotes) {
    masterNotes.innerHTML = (master.notes || [])
      .map(
        (n, i) =>
          `<li class="master-note" style="--i:${i}"><span class="master-note-glyph" aria-hidden="true">${glyphHtml(
            "print"
          )}</span><span>${escapeHtml(n)}</span></li>`
      )
      .join("");
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

function renderInstruments(instruments) {
  const list = Array.isArray(instruments) ? instruments : [];
  const show = list.length > 0;
  instrumentsEmpty?.classList.toggle("hidden", show);
  instrumentsList?.classList.toggle("hidden", !show);
  if (instrumentsEmpty && !show) {
    const target = lastAdvice?.target || analysisTarget;
    instrumentsEmpty.innerHTML =
      target === "vocal"
        ? `<p>Vocal mode doesn’t detect bed sources. Switch to <strong>Instrumental</strong> or <strong>Full mix</strong> and re-run.</p>`
        : `<p>No sources detected on this pass. Try <strong>Full mix</strong> or a clearer instrumental stem.</p>`;
  }
  if (!instrumentsList) return;
  if (!show) {
    instrumentsList.innerHTML = "";
    return;
  }
  instrumentsList.innerHTML = list
    .map((item, i) => {
      const pct = Math.round((item.confidence || 0) * 100);
      return `
        <li class="instrument-card" style="--i:${i}">
          <div class="instrument-card-head">
            <span class="instrument-glyph" aria-hidden="true">${glyphHtml("sources")}</span>
            <strong>${escapeHtml(item.label)}</strong>
            <span class="instrument-conf">${pct}%</span>
          </div>
          <div class="instrument-meter" aria-hidden="true">
            <span style="width:${pct}%"></span>
          </div>
          <p class="instrument-tip">${escapeHtml(item.tip || "")}</p>
        </li>`;
    })
    .join("");
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
          <div class="pro-pick-copy">
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

function shortenWhyText(text, maxLen = 92) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const first = raw.split(/(?<=[.!?])\s+/)[0] || raw;
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen - 1).trim()}…`;
}

function renderSummary(traits, advice) {
  const findings = (traits?.findings || [])
    .filter((f) => f?.label && f.label !== "Target" && f.label !== "Source")
    .slice(0, 6);
  const fallback = (traits?.summary || []).slice(0, 6);
  const order = advice?.chain?.orderWhy;

  if (summaryRoot) {
    if (findings.length) {
      summaryRoot.innerHTML = findings
        .map(
          (f, i) => `
            <li class="why-fact" style="--i:${i}">
              <span class="why-fact-top">
                <span class="why-fact-glyph">${glyphHtml(f.label)}</span>
                <span class="why-fact-label">${escapeHtml(f.label)}</span>
              </span>
              <p class="why-fact-text">${escapeHtml(shortenWhyText(f.text))}</p>
            </li>`
        )
        .join("");
    } else if (fallback.length) {
      summaryRoot.innerHTML = fallback
        .map((s, i) => {
          const str = String(s);
          const hasLabel = str.includes(": ");
          const label = hasLabel ? str.split(":")[0] : "Note";
          const text = hasLabel ? str.split(/:\s(.*)/s)[1] || str : str;
          return `
            <li class="why-fact" style="--i:${i}">
              <span class="why-fact-top">
                <span class="why-fact-glyph">${glyphHtml(label)}</span>
                <span class="why-fact-label">${escapeHtml(label)}</span>
              </span>
              <p class="why-fact-text">${escapeHtml(shortenWhyText(text))}</p>
            </li>`;
        })
        .join("");
    } else {
      summaryRoot.innerHTML = `<li class="why-fact is-empty"><p class="why-fact-text">Run an analysis to see measurements.</p></li>`;
    }
  }

  if (whyOrderRoot) {
    const inserts = Array.isArray(order?.inserts)
      ? order.inserts
      : advice?.chain?.inserts?.map((s) => s.title).filter(Boolean) || [];
    const sends = Array.isArray(order?.sends)
      ? order.sends
      : advice?.chain?.sends?.map((s) => s.title).filter(Boolean) || [];

    const items = [
      ...inserts.map((title) => ({ title, kind: "Insert" })),
      ...sends.map((title) => ({ title, kind: "Send" })),
    ];

    whyOrderRoot.innerHTML = items.length
      ? items
          .map(
            (item) => `
            <li>
              <span class="why-order-kind">${escapeHtml(item.kind)}</span>
              <span class="why-order-title">${escapeHtml(item.title)}</span>
            </li>`
          )
          .join("")
      : `<li class="is-empty">Stage order appears once a chain is ready.</li>`;
  }

  if (whyTipEl) {
    const tip =
      (typeof order === "object" && order && !Array.isArray(order) && order.tip) ||
      (Array.isArray(order) ? order[order.length - 1] : "") ||
      "";
    whyTipEl.textContent = tip || "";
    whyTipEl.classList.toggle("hidden", !tip);
  }
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
  const n = kind === "send" ? "S" : String(entry.index + 1).padStart(2, "0");
  return `
    <button type="button" class="stage-chip" role="tab" data-stage-index="${globalIndex}" data-stage-kind="${kind}" data-stage-state="next" aria-selected="false">
      <span class="stage-chip-n" aria-hidden="true">${escapeHtml(n)}</span>
      <span class="stage-chip-copy">
        <span class="stage-chip-title">${escapeHtml(step.title)}</span>
        <span class="stage-chip-type">${escapeHtml(type)}</span>
      </span>
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
      ? `<div class="step-why">
          <p class="step-why-label">Why this setting</p>
          ${step.why ? `<p class="why">${escapeHtml(step.why)}</p>` : ""}
          ${step.how ? `<p class="how">${escapeHtml(step.how)}</p>` : ""}
        </div>`
      : "";
  const affiliates = analysisMode === "deep" ? renderAffiliates(step) : "";

  stageFocus.innerHTML = `
    <article class="chain-step">
      <div class="step-copy">
        <header class="step-intro">
          <div class="step-head">
            <span class="step-index">${kind === "send" ? "Send" : `Step ${index + 1}`}</span>
            <span class="type-badge">${escapeHtml(type)}</span>
            <span class="tier">${tierLabel(step.tier)}</span>
          </div>
          <h3 class="step-title">${escapeHtml(step.title)}</h3>
          ${gap}
        </header>
        ${tips}
        ${affiliates}
      </div>
      ${face ? `<div class="step-rack">${face}</div>` : ""}
    </article>`;

  stageFocus.scrollTop = 0;

  document.querySelectorAll("[data-stage-index]").forEach((btn) => {
    const i = Number(btn.getAttribute("data-stage-index"));
    const state = i < stageIndex ? "past" : i === stageIndex ? "current" : "next";
    btn.setAttribute("aria-selected", String(i === stageIndex));
    btn.setAttribute("data-stage-state", state);
  });

  if (stageCount) stageCount.textContent = `${stageIndex + 1} / ${stages.length}`;
  if (stagePrev) stagePrev.disabled = stageIndex <= 0;
  if (stageNext) stageNext.disabled = stageIndex >= stages.length - 1;
}

function selectStage(index) {
  if (!stages.length) return;
  stageIndex = Math.max(0, Math.min(stages.length - 1, index));
  renderFocus();
  updateStageRailMore();
  const activeChip = document.querySelector(`[data-stage-index="${stageIndex}"]`);
  // Keep the chip strip in place — only nudge the active chip into the horizontal viewport
  activeChip?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}

function canScrollMoreRight(el) {
  if (!el) return false;
  const max = el.scrollWidth - el.clientWidth;
  return max > 6 && el.scrollLeft < max - 6;
}

function updateStageRailMore() {
  if (!stageRailShell || !stageRailMore) return;
  const show =
    canScrollMoreRight(stageRailScroll) ||
    canScrollMoreRight(stageRailInserts) ||
    canScrollMoreRight(stageRailSends);
  stageRailShell.classList.toggle("has-more-right", show);
}

function bindStageRail(root) {
  root?.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("[data-stage-index]");
    if (!btn) return;
    // Keep early steps visible — default focus scroll would shove Step 1/2 off-rail
    e.preventDefault();
    btn.focus({ preventScroll: true });
  });
  root?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stage-index]");
    if (!btn) return;
    selectStage(Number(btn.getAttribute("data-stage-index")));
    btn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    requestAnimationFrame(updateStageRailMore);
  });
  root?.addEventListener("scroll", updateStageRailMore, { passive: true });
}

bindStageRail(stageRailInserts);
bindStageRail(stageRailSends);
stageRailScroll?.addEventListener("scroll", updateStageRailMore, { passive: true });
let stageRailResizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(stageRailResizeTimer);
  stageRailResizeTimer = setTimeout(updateStageRailMore, 120);
});

exportPdfBtn?.addEventListener("click", async () => {
  if (!lastAdvice?.chain || !exportPdfBtn) return;
  const label = exportPdfBtn.textContent;
  exportPdfBtn.classList.add("is-busy");
  exportPdfBtn.textContent = "Exporting…";
  try {
    const { downloadChainPdf } = await import("../export/chain-pdf.js");
    const result = library.active()?.result || null;
    const readout = result?.readout || null;
    const traits = result?.traits || lastAdvice.traits || null;
    const keyLabel =
      readout?.pitch?.keyLabel ||
      readout?.keyLabel ||
      readout?.pitch?.keyCandidates?.[0]?.label ||
      undefined;
    const bpm = readout?.tempo?.bpm ?? readout?.bpm ?? undefined;
    await downloadChainPdf(lastAdvice, {
      trackName: lastTrackName || undefined,
      keyLabel,
      bpm,
      readout,
      traits,
    });
  } catch (err) {
    console.error(err);
    alert(err.message || "Could not export PDF. Check your connection and try again.");
  } finally {
    exportPdfBtn.classList.remove("is-busy");
    exportPdfBtn.textContent = label || "Export Analysis PDF";
  }
});

exportAbletonBtn?.addEventListener("click", async () => {
  if (!lastAdvice?.chain || !exportAbletonBtn) return;
  const label = exportAbletonBtn.textContent;
  exportAbletonBtn.disabled = true;
  exportAbletonBtn.textContent = "Building…";
  try {
    const { buildAbletonRack } = await import("../export/ableton-rack.js");
    const { blob, included, skipped, eqNotes } = await buildAbletonRack(lastAdvice.chain, {
      name: lastTrackName || "Chainprint Chain",
    });
    if (!included.length && !eqNotes.length) {
      alert("This chain has no stages that map to Ableton stock devices yet — use the PDF export.");
      return;
    }
    const slug =
      (lastTrackName || "chainprint-chain")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "chainprint-chain";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.adg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);

    const tips = [];
    tips.push("Drag the .adg onto an audio track in Ableton Live (Standard/Suite).");
    if (eqNotes.length) {
      tips.push(
        `EQ / de-ess stages are in the rack's Info View (and macro names) — dial EQ Eight by hand:\n• ${eqNotes.slice(0, 4).join("\n• ")}`
      );
    }
    if (skipped.length && !eqNotes.length) {
      tips.push(`Add by hand: ${skipped.join(", ")}.`);
    }
    if (tips.length > 1 || eqNotes.length) alert(tips.join("\n\n"));
  } catch (err) {
    console.error(err);
    alert(err.message || "Could not build the Ableton rack.");
  } finally {
    exportAbletonBtn.disabled = false;
    exportAbletonBtn.textContent = label || "Export Chain";
  }
});

shareChainBtn?.addEventListener("click", async () => {
  if (!lastAdvice?.chain || !shareChainBtn) return;
  const label = shareChainBtn.textContent;
  shareChainBtn.disabled = true;
  shareChainBtn.textContent = "Creating link…";
  try {
    const { createSharedChain, sharingAvailable } = await import("../share/chain-share.js");
    if (!sharingAvailable()) {
      alert("Sharing needs the cloud backend — it isn't configured in this build.");
      return;
    }
    const readout = library.active()?.result?.readout || null;
    const { url } = await createSharedChain({
      advice: lastAdvice,
      trackName: lastTrackName || undefined,
      keyLabel: readout?.pitch?.keyLabel || undefined,
      bpm: readout?.tempo?.bpm ?? undefined,
      artworkUrl:
        typeof library.active()?.artwork === "string" && /^https?:/.test(library.active().artwork)
          ? library.active().artwork
          : undefined,
    });
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      /* clipboard can be blocked — fall back to prompt below */
    }
    if (copied) {
      shareChainBtn.textContent = "Link copied";
      setTimeout(() => {
        if (shareChainBtn) shareChainBtn.textContent = label || "Share link";
      }, 2200);
    } else {
      prompt("Share this chain:", url);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Could not create the share link.");
  } finally {
    shareChainBtn.disabled = false;
    if (shareChainBtn.textContent === "Creating link…") {
      shareChainBtn.textContent = label || "Share link";
    }
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
    if (whyIntentEl) whyIntentEl.textContent = "";
    if (whyTipEl) {
      whyTipEl.textContent = "";
      whyTipEl.classList.add("hidden");
    }
    if (estimateNoteEl) estimateNoteEl.textContent = "";
    if (stageRailInserts) stageRailInserts.innerHTML = "";
    if (stageRailSends) stageRailSends.innerHTML = "";
    stageRailShell?.classList.remove("has-more-right");
    if (stageFocus) stageFocus.innerHTML = "";
    if (highlightsRoot) highlightsRoot.innerHTML = "";
    if (highlightsWhy) highlightsWhy.innerHTML = "";
    if (whyOrderRoot) whyOrderRoot.innerHTML = "";
    if (summaryRoot) summaryRoot.innerHTML = "";
    applyChainFxFromAdvice(null);
    return;
  }

  applyChainFxFromAdvice(advice);

  const { chain } = advice;
  if (honestyEl) honestyEl.textContent = chain.honesty;
  if (whyIntentEl) {
    whyIntentEl.textContent =
      "Settings match measured roles on this reference — not a claim these were the exact plugins on the record.";
  }
  if (estimateNoteEl) {
    estimateNoteEl.textContent =
      "Exports an Ableton rack with settings dialed from this reference.";
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

  requestAnimationFrame(updateStageRailMore);

  const highlightsHtml = advice.highlights?.length
    ? `<p class="section-label">Start here</p>
      <ol class="why-moves">` +
      advice.highlights
        .slice(0, 3)
        .map(
          (h, i) => `
          <li class="why-move" style="--i:${i}">
            <span class="why-move-glyph" aria-hidden="true">${glyphHtml(h.stage || h.title || "eq")}</span>
            <div class="why-move-copy">
              <p class="why-move-stage">${escapeHtml(h.stage || h.title || h.characteristic || "Stage")}</p>
              <p class="why-move-action">${escapeHtml(shortenWhyText(h.action || h.body || h.why || "", 120))}</p>
              ${
                h.because
                  ? `<p class="why-move-because">${escapeHtml(shortenWhyText(h.because, 110))}</p>`
                  : ""
              }
            </div>
          </li>`
        )
        .join("") +
      `</ol>`
    : "";
  if (highlightsRoot) highlightsRoot.innerHTML = "";
  if (highlightsWhy) {
    highlightsWhy.innerHTML = highlightsHtml;
    highlightsWhy.classList.toggle("hidden", !highlightsHtml);
  }

  setHasResults(true);
  selectStage(0);
  const restore = pendingViewAfterAnalysis;
  pendingViewAfterAnalysis = null;
  setView(restore === "design" || restore === "master" ? restore : "chain");
}

function showError(message, meta = null, opts = {}) {
  setProgress(false);
  lastAdvice = null;
  renderMaster(null);
  renderDesign(null);
  renderInstruments(null);
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
  renderInstruments(null);
  showIdentity(false);
  stopAudio();
  if (lastSource.kind === "file") {
    showTrackCard(null);
    lastTrackName = lastSource.file?.name?.replace(/\.[^.]+$/, "") || "";
  }
  const readingLabel = "Reading the reference…";
  const readingDetail =
    analysisMode === "deep"
      ? analysisTarget === "vocal"
        ? "Measuring vocal + master bus to build a Pro chain."
        : analysisTarget === "instrumental"
          ? "Measuring the bed + master bus for a Pro instrumental chain."
          : "Measuring mix-bus balance + master delivery targets."
      : analysisTarget === "vocal"
        ? "Measuring tone, dynamics, and stereo to build your vocal chain."
        : analysisTarget === "instrumental"
          ? "Measuring low end, glue, and width to build the instrumental chain."
          : "Measuring full-mix balance to build the mix-bus chain.";
  if (emptyEl) {
    unmountHeroMark?.();
    unmountHeroMark = null;
    emptyEl.classList.remove("hidden");
    emptyEl.innerHTML = `
      <div data-analyze-hero aria-hidden="true"></div>
      <h2>${analysisMode === "deep" ? "Deep analysis…" : readingLabel}</h2>
      <p>${readingDetail}</p>`;
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

    let result;
    if (lastSource.kind === "url") {
      result = await analyzeUrl(lastSource.url, {
        pluginMap,
        daw,
        mode: analysisMode,
        target: analysisTarget,
        manualQuery: lastSource.manualQuery,
        onProgress,
      });
    } else {
      result = await analyzeFile(lastSource.file, {
        pluginMap,
        daw,
        mode: analysisMode,
        target: analysisTarget,
        onProgress,
      });
    }

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
        target: analysisTarget,
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

    // On stacked mobile layout the new row can land past the rail's scroll edge
    if (window.matchMedia("(max-width: 960px)").matches && entry) {
      document
        .querySelector(`[data-library-select="${entry.id}"]`)
        ?.closest("li")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    if (shouldConsumeQuota) {
      await consumeAnalysis();
      shouldConsumeQuota = false;
      refreshQuotaChrome();
      applyAccessGate();
    }

    setProgress(true, { label: "Chain ready", progress: 1, stage: "done" });
    await new Promise((r) => setTimeout(r, 220));
    if (gen !== analysisGen) return;
    setProgress(false);
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      console.log("[chainprint]", result);
    }
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
  // Invisible file input covers the dropzone (pointer-events: auto) so the
  // native picker opens on click. Keyboard still goes through the dropzone.
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!analyzing && !blending) fileInput.click();
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
  fileInput.addEventListener("click", (e) => {
    if (analyzing || blending) e.preventDefault();
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
    if (library.blendPicks().length > 0) blendPanelOpen = true;
    renderLibrary();
    return;
  }
  if (e.target.closest("[data-dry-play]") || e.target.closest("[data-dry-select]")) {
    e.preventDefault();
    e.stopPropagation();
    const dryFor = e.target.closest("[data-dry-for]")?.getAttribute("data-dry-for");
    if (dryFor && library.active()?.id !== dryFor) {
      selectLibraryEntry(dryFor);
    }
    toggleDryPlayback();
    return;
  }
  if (e.target.closest("[data-dry-remove]")) {
    e.preventDefault();
    e.stopPropagation();
    const dryFor =
      e.target.closest("[data-dry-for]")?.getAttribute("data-dry-for") || library.active()?.id;
    clearDryStem(dryFor);
    return;
  }
  const play = e.target.closest("[data-library-play]");
  if (play) {
    e.preventDefault();
    e.stopPropagation();
    const id = play.getAttribute("data-library-play");
    if (id && id.endsWith(":dry")) {
      toggleDryPlayback();
      return;
    }
    toggleEntryPlayback(library.get(id));
    return;
  }
  const remove = e.target.closest("[data-library-remove]");
  if (remove) {
    e.preventDefault();
    e.stopPropagation();
    if (analyzing || blending) return;
    // Prefer the row id so we never remove the wrong entry if attributes drift
    const row = remove.closest("[data-library-id]");
    const id =
      row?.getAttribute("data-library-id") || remove.getAttribute("data-library-remove");
    if (!id || !library.get(id)) return;

    const wasActive = library.active()?.id === id;
    library.remove(id);
    dryByEntryId.delete(id);

    const stillPlaying = playingKey();
    if (stillPlaying && (stillPlaying === id || String(stillPlaying).startsWith(`${id}:`))) {
      stopAudio();
    }
    renderLibrary();
    schedulePersist();
    if (!wasActive) return;

    const next = library.active();
    syncDryInputsFromActive();
    if (next?.result) {
      applyEntryToStudio(next);
      return;
    }
    if (library.list().length) {
      const fallback = library.list().filter((e) => e.result).at(-1);
      if (fallback) {
        library.setActive(fallback.id);
        syncDryInputsFromActive();
        applyEntryToStudio(fallback);
        renderLibrary();
        return;
      }
    }
    lastAdvice = null;
    lastSource = null;
    setHasResults(false);
    renderMaster(null);
    renderDesign(null);
    renderInstruments(null);
    showTrackCard(null);
    setStatus("idle", "Waiting for a reference");
    return;
  }
  const select = e.target.closest("[data-library-select]");
  if (select) {
    selectLibraryEntry(select.getAttribute("data-library-select"));
  }
});

blendWeightBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    blendWeight = Number(btn.getAttribute("data-blend-weight")) || 0.5;
    blendWeightBtns.forEach((b) => {
      const on = b === btn;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const [a, b] = library.blendPicks();
    renderBlendDiffPreview(a, b);
  });
});

blendToggle?.addEventListener("click", () => {
  blendPanelOpen = !blendPanelOpen;
  blendPanel?.classList.toggle("is-collapsed", !blendPanelOpen);
  blendToggle.setAttribute("aria-expanded", blendPanelOpen ? "true" : "false");
});

function setSourceCollapsed(collapsed) {
  const on = Boolean(collapsed);
  workspace?.classList.toggle("is-source-collapsed", on);
  if (sourceCollapseBtn) {
    sourceCollapseBtn.setAttribute("aria-expanded", String(!on));
    sourceCollapseBtn.title = on ? "Expand reference panel" : "Collapse reference panel";
    const sr = sourceCollapseBtn.querySelector(".sr-only");
    if (sr) sr.textContent = on ? "Expand reference panel" : "Collapse reference panel";
  }
  if (sourcePeekBtn) {
    // Peek strip is mobile-only chrome for a collapsed rail
    sourcePeekBtn.hidden = !on;
  }
  syncSourcePeek();
  try {
    localStorage.setItem(SOURCE_COLLAPSE_KEY, on ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function syncSourcePeek() {
  if (!sourcePeekMeta) return;
  const n = library.list().filter((e) => e.kind === "track" && e.result).length;
  sourcePeekMeta.textContent = n ? `${n} track${n === 1 ? "" : "s"} · tap to upload or play` : "Tap to upload a reference";
}

sourceCollapseBtn?.addEventListener("click", () => {
  setSourceCollapsed(!workspace?.classList.contains("is-source-collapsed"));
});

sourcePeekBtn?.addEventListener("click", () => {
  setSourceCollapsed(false);
  document.querySelector("[data-source-rail]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

try {
  // On mobile, always start expanded so uploads stay obvious after refresh
  const preferCollapsed =
    localStorage.getItem(SOURCE_COLLAPSE_KEY) === "1" &&
    !window.matchMedia("(max-width: 960px)").matches;
  if (preferCollapsed) setSourceCollapsed(true);
  else setSourceCollapsed(false);
} catch {
  setSourceCollapsed(false);
}

blendGo?.addEventListener("click", () => {
  if (!applyAccessGate()) return;
  rebuildBlend();
});

bindReadoutExplainers();

const restored = await restoreWorkspace();
persistReady = true;
await persistWorkspaceNow();

renderLibrary();
applyAccessGate();

const active = library.active();
if (restored && active?.result) {
  applyEntryToStudio(active);
  setStatus("live", "Welcome back — chain ready");
} else {
  setStatus("idle", "Waiting for a reference");
}
setView("chain");

window.addEventListener("pagehide", () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  void persistWorkspaceNow();
});
