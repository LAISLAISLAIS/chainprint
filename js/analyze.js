/**
 * Decode local audio → measure → characterize → full vocal chain.
 * Audio never leaves the machine (file upload or user-initiated URL fetch).
 */

import { measureBuffer } from "./dsp/metrics.js";
import { characterize, recommend } from "./recommend.js";
import { resolveReferenceUrl } from "./source.js";

export async function decodeFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return audioBuffer;
  } finally {
    await ctx.close();
  }
}

function tick() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/**
 * @param {File} file
 * @param {{ pluginMap?: object, daw?: string, meta?: object, onProgress?: (p: {stage:string,label:string,progress:number}) => void }} [options]
 */
export async function analyzeFile(file, { pluginMap = null, daw = "universal", meta = null, mode = "standard", onProgress } = {}) {
  const report = (stage, label, progress) => onProgress?.({ stage, label, progress });

  report("loading", "Loading audio…", 0.08);
  await tick();
  const buffer = await decodeFile(file);

  report("decoding", "Decoding waveform…", 0.32);
  await tick();

  report("measuring", mode === "deep" ? "Deep measuring vocal + master…" : "Measuring vocal signature…", 0.55);
  await tick();
  const readout = measureBuffer(buffer);

  report("characterizing", "Reading tone, tempo & pitch…", 0.72);
  await tick();
  const traits = characterize(readout);

  report("building", mode === "deep" ? "Building Pro vocal + master chain…" : "Building vocal chain…", 0.88);
  await tick();
  const advice = pluginMap ? recommend(traits, pluginMap, daw, readout, mode) : null;

  report("done", "Chain ready", 1);

  return {
    source: {
      name: meta?.matchedTitle
        ? `${meta.matchedArtist || meta.artist || ""} — ${meta.matchedTitle}`.replace(/^ — /, "")
        : file.name,
      size: file.size,
      type: file.type || "audio/*",
      origin: file._chainprintOrigin || meta?.platform || "upload",
      meta,
    },
    readout,
    traits: advice?.traits || traits,
    advice,
    mode,
  };
}

export async function analyzeUrl(url, options = {}) {
  options.onProgress?.({ stage: "resolving", label: "Resolving link…", progress: 0.05 });
  const resolved = await resolveReferenceUrl(url, { manualQuery: options.manualQuery });
  options.onProgress?.({ stage: "downloading", label: "Fetching preview audio…", progress: 0.18 });
  return analyzeFile(resolved.file, { ...options, meta: resolved.meta });
}

export function formatReadoutConsole(result) {
  const { source, readout: r, traits, advice } = result;
  const metaNote = source.meta?.note ? `\nMETA    ${source.meta.note}` : "";
  const lines = [
    `SOURCE  ${source.name} (${source.origin || "upload"})${metaNote}`,
    `NOTE    ${r.note}`,
    `SR      ${r.sampleRate} Hz · ${r.durationSec.toFixed(2)} s · ${r.frames} frames`,
    "",
    "BANDS (dB rel total · vocal-weighted estimate)",
    ...r.bands.map((b) => `  ${b.label.padEnd(12)} ${b.dbRelTotal.toFixed(2)}`),
    "",
    `CENTROID  ${r.centroidHz.toFixed(1)} Hz`,
    `TONE      air ${r.tone.air.toFixed(2)}  sib ${r.tone.sibilance.toFixed(2)}  harsh ${r.tone.harshness.toFixed(2)}  mud ${r.tone.mud.toFixed(2)}`,
    `DYNAMICS  peak ${r.dynamics.peakDb.toFixed(2)}  rms ${r.dynamics.rmsDb.toFixed(2)}  crest ${r.dynamics.crestDb.toFixed(2)}  range ${r.dynamics.shortTermRangeDb.toFixed(2)}`,
    `STEREO    corr ${r.stereo.correlation.toFixed(3)}  side/mid ${r.stereo.sideMidRatio.toFixed(3)}`,
  ];

  if (r.tempo?.bpm) {
    lines.push(
      `TEMPO     ${r.tempo.bpm} BPM${r.tempo.feel ? ` · ${r.tempo.feel}` : ""} · conf ${r.tempo.confidence ?? "—"}`
    );
  }
  if (r.pitch?.keyLabel || r.pitch?.f0Hz) {
    lines.push(
      `PITCH     ${r.pitch.keyLabel || "key?"} · F0 ${r.pitch.f0Hz != null ? `${r.pitch.f0Hz.toFixed(1)} Hz` : "—"} (${r.pitch.register || "?"})`
    );
  }
  if (r.eqTargets) {
    lines.push(
      `EQ PEAKS  mud ${r.eqTargets.mudHz}  harsh ${r.eqTargets.harshHz}  deess ${r.eqTargets.deessHz}  air ${r.eqTargets.airHz}`
    );
  }
  if (traits) {
    lines.push(
      "",
      "TRAITS",
      `  tone   air=${traits.tone.air} sib=${traits.tone.sibilance} harsh=${traits.tone.harshness} mud=${traits.tone.mud}`,
      `  dyn    ${traits.dynamics} · stereo ${traits.stereo}`,
      ...traits.summary.map((s) => `  · ${s}`)
    );
  }

  if (advice?.chain) {
    lines.push("", `VOCAL CHAIN (${advice.daw}) — build this in order`);
    lines.push(`  ${advice.honesty}`);
    advice.chain.inserts.forEach((step, i) => {
      lines.push(`  ${i + 1}. [${step.type || "Insert"}] ${step.title} — ${step.plugin}`);
      const settings =
        step.settings ||
        (step.dials || []).map((d) => `${d.label}: ${d.value}`).join(" · ") ||
        (step.copy || []).join(" · ");
      if (settings) lines.push(`     ${settings}`);
    });
    lines.push("  SENDS");
    advice.chain.sends.forEach((step) => {
      lines.push(`  · ${step.title} — ${step.plugin}`);
      const settings =
        step.settings ||
        (step.dials || []).map((d) => `${d.label}: ${d.value}`).join(" · ") ||
        (step.copy || []).join(" · ");
      if (settings) lines.push(`     ${settings}`);
    });
  }

  return lines.join("\n");
}
