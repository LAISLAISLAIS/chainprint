/**
 * Export a Chainprint chain as an Ableton Live Audio Effect Rack (.adg).
 *
 * .adg = gzip-compressed XML (GroupDevicePreset). We assemble a single-chain
 * rack from stock Live devices that ship with every Standard/Suite install:
 *   StereoGain (Utility), Compressor2, CrossDelay (Simple Delay), Reverb.
 *
 * EQ / de-esser / saturation stages have no safe stock preset we can mutate
 * without a verified EQ Eight template, so those dials are written into the
 * rack Annotation (visible in Live's Info View) and reported as skipped.
 */

import { ABLETON_TEMPLATES_B64 } from "./ableton-templates.js";

/** @type {Record<string, string> | null} */
let templates = null;

/**
 * @param {{ inserts?: object[], sends?: object[] } | null} chain
 * @param {{ name?: string }} [meta]
 * @returns {Promise<{ blob: Blob, included: string[], skipped: string[], eqNotes: string[] }>}
 */
export async function buildAbletonRack(chain, meta = {}) {
  const tpl = await loadTemplates();
  const inserts = Array.isArray(chain?.inserts) ? chain.inserts : [];
  const sends = Array.isArray(chain?.sends) ? chain.sends : [];

  /** @type {string[]} */
  const deviceXmls = [];
  const included = [];
  const skipped = [];
  /** @type {string[]} */
  const eqNotes = [];

  // Width / gain trim first when present
  let widthMode = null;
  for (const step of inserts) {
    const kind = String(step?.visual?.kind || "");
    if (kind === "width" || kind === "imaging") {
      widthMode = String(step.visual.mode || "center");
    }
  }

  const utility = mutateUtility(tpl.StereoGain, {
    name: "Utility",
    width: widthMode === "center" ? 0.55 : widthMode ? 1.4 : 1,
  });
  deviceXmls.push(utility);
  if (widthMode) included.push("Width → Utility");

  for (const step of [...inserts, ...sends]) {
    const visual = step?.visual;
    if (!visual || typeof visual !== "object") continue;
    const label = String(step.title || visual.kind || "stage");
    const kind = String(visual.kind || "");

    if (kind === "eq" || kind === "deesser") {
      eqNotes.push(...formatEqNotes(label, visual));
      skipped.push(label);
      continue;
    }
    if (kind === "gain" || kind === "width" || kind === "imaging" || kind === "modulation") {
      continue; // silent / already handled
    }

    if (kind === "compressor") {
      deviceXmls.push(mutateCompressor(tpl.Compressor2, visual, label));
      included.push(label);
    } else if (kind === "limiter") {
      deviceXmls.push(mutateCompressor(tpl.Compressor2, { ...visual, _limiter: true }, label));
      included.push(label);
    } else if (kind === "delay") {
      deviceXmls.push(mutateDelay(tpl.CrossDelay, visual, label));
      included.push(label);
    } else if (kind === "reverb") {
      deviceXmls.push(mutateReverb(tpl.Reverb, visual, label));
      included.push(label);
    } else if (kind === "saturator") {
      skipped.push(label);
    } else {
      skipped.push(label);
    }
  }

  if (!included.length && !eqNotes.length) {
    throw new Error("Nothing in this chain maps to Ableton stock devices yet.");
  }

  // Always keep at least Utility so the rack loads even if only EQ notes
  if (deviceXmls.length === 0) {
    deviceXmls.push(mutateUtility(tpl.StereoGain, { name: "Utility", width: 1 }));
  }

  const rackName = sanitizeName(meta.name || "Chainprint Chain");
  const annotation = buildAnnotation(eqNotes, included, skipped);
  const xml = assembleRack(tpl, deviceXmls, rackName, annotation);
  const gzipped = await gzipUtf8(xml);
  const blob = new Blob([gzipped], { type: "application/octet-stream" });

  return { blob, included, skipped, eqNotes };
}

async function loadTemplates() {
  if (templates) return templates;
  const bin = Uint8Array.from(atob(ABLETON_TEMPLATES_B64), (c) => c.charCodeAt(0));
  const stream = new DecompressionStream("gzip");
  const plain = await new Response(new Blob([bin]).stream().pipeThrough(stream)).text();
  templates = JSON.parse(plain);
  return templates;
}

/**
 * @param {Record<string, string>} tpl
 * @param {string[]} devicePresets  AbletonDevicePreset XML strings
 * @param {string} rackName
 * @param {string} annotation
 */
function assembleRack(tpl, devicePresets, rackName, annotation) {
  let aegd = tpl._AudioEffectGroupDevice;
  aegd = setTagValue(aegd, "UserName", rackName);
  aegd = setTagValue(aegd, "Annotation", annotation.slice(0, 1800));

  // Seed first few macro names with EQ notes so they show on the rack face
  const macroHints = annotation
    .split("\n")
    .filter((l) => l.startsWith("EQ ·") || l.startsWith("De-ess ·"))
    .slice(0, 8);
  for (let i = 0; i < 8; i++) {
    const name = macroHints[i] ? macroHints[i].replace(/^(EQ|De-ess) · /, "").slice(0, 28) : i === 0 ? "Chainprint" : "";
    aegd = aegd.replace(
      new RegExp(`(<MacroDisplayNames\\.${i} Value=")[^"]*(")`),
      `$1${escAttr(name)}$2`
    );
  }

  // Build single chain with our devices
  let branch = tpl._BranchSkeleton;
  branch = setAttr(branch, "AudioEffectBranchPreset", "Id", "0");
  branch = setTagValue(branch, "Name", "Chain");

  const presetsInner = devicePresets
    .map((xml, i) => setAttr(xml, "AbletonDevicePreset", "Id", String(i)))
    .join("\n");
  branch = branch.replace(/<DevicePresets\s*\/>/, `<DevicePresets>\n${presetsInner}\n</DevicePresets>`);
  // Also handle non-self-closing empty DevicePresets
  branch = branch.replace(/<DevicePresets>\s*<\/DevicePresets>/, `<DevicePresets>\n${presetsInner}\n</DevicePresets>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0_11202" SchemaChangeCount="11" Creator="Chainprint" Revision="chainprint-ableton-export">
\t<GroupDevicePreset>
\t\t<OverwriteProtectionNumber Value="2818" />
\t\t<Device>
${indent(aegd, 3)}
\t\t</Device>
\t\t<PresetRef>
\t\t\t<Value />
\t\t</PresetRef>
\t\t<BranchPresets>
${indent(branch, 3)}
\t\t</BranchPresets>
\t\t<ReturnBranchPresets />
\t</GroupDevicePreset>
</Ableton>
`;
}

function mutateUtility(adpXml, { name, width }) {
  let xml = adpXml;
  xml = setDeviceUserName(xml, name);
  xml = setManual(xml, "StereoWidth", clamp(width, 0, 4));
  return xml;
}

function mutateCompressor(adpXml, visual, label) {
  const isLimiter = Boolean(visual._limiter);
  const ratio = clamp(Number(visual.ratio) || (isLimiter ? 20 : 3), 1, 20);
  const gr = Number.isFinite(Number(visual.grDb ?? visual.catchDb))
    ? Number(visual.grDb ?? visual.catchDb)
    : isLimiter
      ? 2
      : 4;
  const thresholdDb = clamp(isLimiter ? -6 - gr : -18 - gr * 1.5, -60, 0);
  const thresholdLin = Math.pow(10, thresholdDb / 20);
  const attack = clamp(Number(visual.attackMs) || (isLimiter ? 1 : 15), 0.01, 1000);
  const release = clamp(Number(visual.releaseMs) || 80, 1, 3000);
  const makeup = clamp(gr * 0.55, 0, 12);
  const knee = String(visual.knee || "").toLowerCase() === "hard" || isLimiter ? 0 : 6;

  let xml = adpXml;
  xml = setDeviceUserName(xml, label);
  xml = setManual(xml, "Threshold", thresholdLin);
  xml = setManual(xml, "Ratio", ratio);
  xml = setManual(xml, "Attack", attack);
  xml = setManual(xml, "Release", release);
  xml = setManual(xml, "Gain", makeup);
  xml = setManual(xml, "Knee", knee);
  xml = setManual(xml, "DryWet", 1);
  xml = setManual(xml, "Model", isLimiter ? 0 : 1); // 0 peak-ish, 1 RMS-ish
  return xml;
}

function mutateDelay(adpXml, visual, label) {
  const ms = clamp(parseDelayMs(visual.time) ?? 280, 1, 300);
  const feedbackPct = clamp(Number(visual.feedbackPct) || 20, 0, 90);
  const feedback = clamp(feedbackPct / 100, 0, 0.95);
  // Serial placement — keep some dry so the chain doesn't go 100% wet
  const dryWet = 0.32;

  const timeStr = String(visual.time || "");
  const useSync = /1\/\d/.test(timeStr);
  let beatEnum = 1; // default 1/8-ish
  if (/1\/16/.test(timeStr)) beatEnum = 0;
  else if (/1\/8/.test(timeStr)) beatEnum = 1;
  else if (/1\/4/.test(timeStr)) beatEnum = 2;
  else if (/1\/2/.test(timeStr)) beatEnum = 3;

  let xml = adpXml;
  xml = setDeviceUserName(xml, label);
  xml = setManual(xml, "SyncModeLeft", useSync);
  xml = setManual(xml, "SyncModeRight", useSync);
  xml = setManual(xml, "BeatDelayEnumL", beatEnum);
  xml = setManual(xml, "BeatDelayEnumR", beatEnum);
  xml = setManual(xml, "MsDelayLeft", ms);
  xml = setManual(xml, "MsDelayRight", Math.min(300, ms * 1.03));
  xml = setManual(xml, "Feedback", feedback);
  xml = setManual(xml, "DryWet", dryWet);
  xml = setManual(xml, "Linked", false);
  return xml;
}

function mutateReverb(adpXml, visual, label) {
  const size = String(visual.size || "").toLowerCase();
  let roomSize = 80;
  let decay = 2200;
  if (size.includes("hall") || size.includes("large") || size.includes("ambient")) {
    roomSize = 220;
    decay = 5500;
  } else if (size.includes("room") || size.includes("chamber")) {
    roomSize = 90;
    decay = 2800;
  } else if (size.includes("plate") || size.includes("short")) {
    roomSize = 35;
    decay = 1100;
  }
  const preDelay = clamp(Number(visual.preDelayMs) || 40, 0.5, 250);

  let xml = adpXml;
  xml = setDeviceUserName(xml, label);
  xml = setManual(xml, "PreDelay", preDelay);
  xml = setManual(xml, "RoomSize", clamp(roomSize, 0.22, 500));
  xml = setManual(xml, "DecayTime", clamp(decay, 200, 60000));
  // Keep dry path open; blend wet underneath (serial chain)
  xml = setManual(xml, "MixDirect", 1);
  xml = setManual(xml, "MixDiffuse", 0.38);
  xml = setManual(xml, "MixReflect", 0.28);
  xml = setManual(xml, "FreezeOn", false);
  return xml;
}

function formatEqNotes(label, visual) {
  const notes = [];
  if (visual.kind === "deesser") {
    const freq = Number(visual.freq) || 6500;
    const red = Number(visual.reductionDb) || 3;
    notes.push(`De-ess · ${label}: −${red} dB @ ${Math.round(freq)} Hz`);
    return notes;
  }
  const bands = Array.isArray(visual.bands) ? visual.bands : [];
  for (const b of bands.slice(0, 6)) {
    const type = String(b.type || "bell");
    const freq = Math.round(Number(b.freq) || 0);
    const gain = Number(b.gain);
    const q = Number(b.q);
    if (type === "hpf" || type === "highpass") {
      notes.push(`EQ · ${label}: HPF @ ${freq} Hz${b.slope ? ` ${b.slope} dB/oct` : ""}`);
    } else if (type === "lpf" || type === "lowpass") {
      notes.push(`EQ · ${label}: LPF @ ${freq} Hz`);
    } else if (Number.isFinite(gain) && Math.abs(gain) >= 0.25) {
      const sign = gain > 0 ? "+" : "";
      const qBit = Number.isFinite(q) && q > 0 ? ` Q ${q}` : "";
      notes.push(`EQ · ${label}: ${sign}${gain.toFixed(1)} dB @ ${freq} Hz${qBit} (${type})`);
    }
  }
  return notes;
}

function buildAnnotation(eqNotes, included, skipped) {
  const lines = [
    "Chainprint → Ableton Live rack",
    "Stock devices only (Utility, Compressor, Simple Delay, Reverb).",
    "",
  ];
  if (eqNotes.length) {
    lines.push("Dial these in EQ Eight / De-esser by hand:");
    lines.push(...eqNotes);
    lines.push("");
  }
  if (included.length) lines.push(`Loaded: ${included.join(", ")}`);
  if (skipped.length) lines.push(`Skipped: ${skipped.join(", ")}`);
  lines.push("chainprint.app");
  return lines.join("\n");
}

// ---- XML helpers ----------------------------------------------------------

function setDeviceUserName(adpXml, name) {
  // Prefer the device's own UserName (first inside <Device>)
  return adpXml.replace(
    /(<Device>\s*<[A-Za-z0-9]+[^>]*>[\s\S]*?<UserName Value=")[^"]*(")/,
    `$1${escAttr(name)}$2`
  );
}

function setManual(xml, tag, value) {
  const v =
    typeof value === "boolean"
      ? value
        ? "true"
        : "false"
      : String(value);
  const re = new RegExp(`(<${tag}>[\\s\\S]*?<Manual Value=")[^"]*(")`);
  if (!re.test(xml)) return xml;
  return xml.replace(re, `$1${escAttr(v)}$2`);
}

function setTagValue(xml, tag, value) {
  const re = new RegExp(`(<${tag} Value=")[^"]*(")`);
  if (!re.test(xml)) return xml;
  return xml.replace(re, `$1${escAttr(value)}$2`);
}

function setAttr(xml, tag, attr, value) {
  const re = new RegExp(`<${tag}([^>]*?)\\s${attr}="[^"]*"`);
  if (re.test(xml)) return xml.replace(re, `<${tag}$1 ${attr}="${escAttr(value)}"`);
  return xml.replace(new RegExp(`<${tag}([\\s>])`), `<${tag} ${attr}="${escAttr(value)}"$1`);
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\n|\r/g, "&#10;");
}

function indent(xml, tabs) {
  const pad = "\t".repeat(tabs);
  return xml
    .trim()
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

function sanitizeName(name) {
  return String(name || "Chainprint")
    .replace(/[<>&"]/g, "")
    .slice(0, 60);
}

function parseDelayMs(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  const s = String(time || "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*ms/i);
  if (m) return Number(m[1]);
  if (/dotted/i.test(s) && /1\/8/.test(s)) return 375;
  if (/1\/8/i.test(s)) return 250;
  if (/1\/4/i.test(s)) return 500;
  if (/1\/16/i.test(s)) return 125;
  return null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

async function gzipUtf8(text) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser can't gzip Ableton files — try Chrome, Edge, or Safari 16.4+.");
  }
  const stream = new CompressionStream("gzip");
  const blob = new Blob([text]);
  return new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer());
}
