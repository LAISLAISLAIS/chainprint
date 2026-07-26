/**
 * Decode local audio → measure → characterize → chain for the selected target.
 * Audio never leaves the machine (file upload or user-initiated URL fetch).
 */

import { measureBufferAsync, normalizeTarget } from "./dsp/metrics.js";
import { characterize, recommend } from "./recommend.js";
import { resolveReferenceUrl } from "./source.js";
import { decodeFile } from "./audio-decode.js";

export { decodeFile };

function tick() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

const MEASURE_LABELS = {
  vocal: {
    standard: "Measuring vocal signature…",
    deep: "Deep measuring vocal + master…",
  },
  instrumental: {
    standard: "Measuring instrumental bed…",
    deep: "Deep measuring instrumental + master…",
  },
  full: {
    standard: "Measuring full mix…",
    deep: "Deep measuring mix bus + master…",
  },
};

const BUILD_LABELS = {
  vocal: {
    standard: "Building vocal chain…",
    deep: "Building Pro vocal + master chain…",
  },
  instrumental: {
    standard: "Building instrumental chain…",
    deep: "Building Pro instrumental + master…",
  },
  full: {
    standard: "Building mix-bus chain…",
    deep: "Building Pro mix-bus + master…",
  },
};

/**
 * @param {File} file
 * @param {{
 *   pluginMap?: object,
 *   daw?: string,
 *   meta?: object,
 *   mode?: string,
 *   target?: string,
 *   sourceKind?: 'estimate' | 'stem',
 *   onProgress?: (p: {stage:string,label:string,progress:number}) => void
 * }} [options]
 */
export async function analyzeFile(
  file,
  {
    pluginMap = null,
    daw = "universal",
    meta = null,
    mode = "standard",
    target = "vocal",
    sourceKind = "estimate",
    onProgress,
  } = {}
) {
  const report = (stage, label, progress) => onProgress?.({ stage, label, progress });
  const resolvedTarget = normalizeTarget(target);
  const deep = mode === "deep";
  const measureLabel = MEASURE_LABELS[resolvedTarget][deep ? "deep" : "standard"];
  const buildLabel = BUILD_LABELS[resolvedTarget][deep ? "deep" : "standard"];

  report("loading", "Loading audio…", 0.08);
  await tick();
  const buffer = await decodeFile(file);

  report("decoding", "Decoding waveform…", 0.28);
  await tick();

  report("measuring", measureLabel, 0.4);
  await tick();
  const readout = await measureBufferAsync(
    buffer,
    (t) => {
      report("measuring", measureLabel, 0.4 + t * 0.28);
    },
    { target: resolvedTarget, sourceKind }
  );

  report("characterizing", "Reading tone, tempo & sources…", 0.74);
  await tick();
  const traits = characterize(readout);

  report("building", buildLabel, 0.88);
  await tick();
  const advice = pluginMap
    ? recommend(traits, pluginMap, daw, readout, mode, resolvedTarget)
    : null;

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
      sourceKind,
    },
    file,
    readout,
    traits: advice?.traits || traits,
    advice,
    mode,
    target: resolvedTarget,
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
  const target = r.target || result.target || "vocal";
  const lines = [
    `SOURCE  ${source.name} (${source.origin || "upload"})${metaNote}`,
    `TARGET  ${target}${r.sourceKind === "stem" ? " · stem" : " · estimate"}`,
    `NOTE    ${r.note}`,
    `SR      ${r.sampleRate} Hz · ${r.durationSec.toFixed(2)} s · ${r.frames} frames`,
    "",
    "BANDS (dB rel total · target-weighted)",
    ...r.bands.map((b) => `  ${b.label.padEnd(12)} ${b.dbRelTotal.toFixed(2)}`),
    "",
    `CENTROID  ${r.centroidHz.toFixed(1)} Hz`,
    `TONE      air ${r.tone.air.toFixed(2)}  sib ${r.tone.sibilance.toFixed(2)}  harsh ${r.tone.harshness.toFixed(2)}  mud ${r.tone.mud.toFixed(2)}`,
    `DYNAMICS  peak ${r.dynamics.peakDb.toFixed(2)}  rms ${r.dynamics.rmsDb.toFixed(2)}  crest ${r.dynamics.crestDb.toFixed(2)}  range ${r.dynamics.shortTermRangeDb.toFixed(2)}`,
    `STEREO    corr ${r.stereo.correlation.toFixed(3)}  side/mid ${r.stereo.sideMidRatio.toFixed(3)}`,
  ];

  if (r.instruments?.length) {
    lines.push(
      "",
      "INSTRUMENTS",
      ...r.instruments.map(
        (i) => `  ${i.label.padEnd(18)} ${(i.confidence * 100).toFixed(0)}% — ${i.tip}`
      )
    );
  }

  if (r.tempo?.bpm) {
    lines.push(
      `TEMPO     ${r.tempo.bpm} BPM${r.tempo.feel ? ` · ${r.tempo.feel}` : ""} · conf ${r.tempo.confidence ?? "—"}${
        r.tempo.reliable ? " · reliable" : " · VERIFY"
      }`
    );
  }
  if (r.pitch) {
    lines.push(
      `PITCH     key ${r.pitch.keyLabel || "ambiguous"}${
        r.pitch.keyReliable ? "" : " (unreliable)"
      }${r.pitch.relativeKey ? ` · rel ${r.pitch.relativeKey}` : ""} · F0 ${
        r.pitch.f0Hz != null ? `${r.pitch.f0Hz.toFixed(1)} Hz` : "—"
      } (${r.pitch.register || "?"})`
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
    lines.push("", `CHAIN (${advice.target || target} · ${advice.daw}) — build this in order`);
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
