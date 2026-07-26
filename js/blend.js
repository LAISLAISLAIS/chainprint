/**
 * Blend two measured mix signatures into one hybrid target.
 * Diffs A↔B with the Compare engine, then builds a contrast-preserving
 * hybrid (keeps distinctive traits) instead of a washed-out midpoint.
 */

import { characterize, recommend } from "./recommend.js";
import { detectInstruments } from "./dsp/instruments.js";
import { normalizeTarget } from "./dsp/metrics.js";
import { compareMixes } from "./match.js";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * When A and B agree (small delta), average.
 * When they diverge, exaggerate the blend weight away from 0.5 so the
 * hybrid keeps character instead of flattening to a bland midpoint.
 */
function contrastMerge(a, b, t, threshold, pull = 0.4) {
  const av = Number(a);
  const bv = Number(b);
  if (!Number.isFinite(av) && !Number.isFinite(bv)) return av;
  if (!Number.isFinite(av)) return bv;
  if (!Number.isFinite(bv)) return av;
  const d = Math.abs(bv - av);
  if (d < threshold) return lerp(av, bv, t);
  const skewed = 0.5 + (t - 0.5) * (1 + pull);
  return lerp(av, bv, Math.max(0, Math.min(1, skewed)));
}

function pickByWeight(a, b, t) {
  return t <= 0.5 ? a : b;
}

function mergeTone(a, b, t) {
  return {
    air: contrastMerge(a.air, b.air, t, 1.5, 0.45),
    sibilance: contrastMerge(a.sibilance, b.sibilance, t, 1.5, 0.4),
    harshness: contrastMerge(a.harshness, b.harshness, t, 1.5, 0.4),
    mud: contrastMerge(a.mud, b.mud, t, 1.2, 0.4),
  };
}

function mergeBands(a = [], b = [], t) {
  const byId = new Map(b.map((x) => [x.id || x.label, x]));
  return a.map((band) => {
    const other = byId.get(band.id || band.label) || band;
    return {
      ...band,
      dbRelTotal: contrastMerge(band.dbRelTotal, other.dbRelTotal, t, 1.2, 0.42),
    };
  });
}

function mergeDynamics(a, b, t) {
  return {
    peakDb: contrastMerge(a.peakDb, b.peakDb, t, 1.5, 0.35),
    rmsDb: contrastMerge(a.rmsDb, b.rmsDb, t, 1.5, 0.35),
    crestDb: contrastMerge(a.crestDb, b.crestDb, t, 1.2, 0.5),
    shortTermRangeDb: contrastMerge(a.shortTermRangeDb, b.shortTermRangeDb, t, 1.5, 0.4),
  };
}

function mergeStereo(a, b, t) {
  return {
    correlation: contrastMerge(a.correlation, b.correlation, t, 0.08, 0.4),
    sideMidRatio: contrastMerge(a.sideMidRatio, b.sideMidRatio, t, 0.06, 0.45),
  };
}

/**
 * Interpolate two readouts with contrast preservation.
 * t=0 → A, t=1 → B, t=0.5 → balanced (still keeps large deltas).
 */
export function blendReadouts(readoutA, readoutB, t = 0.5) {
  const w = Math.max(0, Math.min(1, t));
  const dynamics = mergeDynamics(readoutA.dynamics, readoutB.dynamics, w);
  const stereo = mergeStereo(readoutA.stereo, readoutB.stereo, w);
  const loudA = readoutA.loudness?.lufsProxy ?? readoutA.dynamics.rmsDb;
  const loudB = readoutB.loudness?.lufsProxy ?? readoutB.dynamics.rmsDb;
  const lufsProxy = contrastMerge(loudA, loudB, w, 1.5, 0.3);
  const bands = mergeBands(readoutA.bands, readoutB.bands, w);
  const bandsFullMix = mergeBands(
    readoutA.bandsFullMix || readoutA.bands,
    readoutB.bandsFullMix || readoutB.bands,
    w
  );

  return {
    estimate: true,
    blend: true,
    blendWeight: w,
    target: normalizeTarget(readoutA.target || readoutB.target || "vocal"),
    sourceKind: "estimate",
    note: "Hybrid target from two references — contrast-preserving merge, then A/B both sources by ear.",
    sampleRate: readoutA.sampleRate || readoutB.sampleRate,
    durationSec: lerp(readoutA.durationSec || 0, readoutB.durationSec || 0, w),
    frames: Math.round(lerp(readoutA.frames || 0, readoutB.frames || 0, w)),
    hop: readoutA.hop || readoutB.hop,
    fftSize: readoutA.fftSize || readoutB.fftSize,
    bands,
    bandsFullMix,
    centroidHz: contrastMerge(readoutA.centroidHz, readoutB.centroidHz, w, 200, 0.45),
    centroidFullHz: contrastMerge(
      readoutA.centroidFullHz ?? readoutA.centroidHz,
      readoutB.centroidFullHz ?? readoutB.centroidHz,
      w,
      200,
      0.45
    ),
    tone: mergeTone(readoutA.tone, readoutB.tone, w),
    toneFull: mergeTone(readoutA.toneFull || readoutA.tone, readoutB.toneFull || readoutB.tone, w),
    dynamics,
    stereo,
    loudness: {
      lufsProxy,
      note: readoutA.loudness?.note || "Approximate loudness proxy — not certified LUFS.",
    },
    transientIndex: contrastMerge(
      readoutA.transientIndex ?? 0,
      readoutB.transientIndex ?? 0,
      w,
      0.08,
      0.4
    ),
    transientIndexFull: contrastMerge(
      readoutA.transientIndexFull ?? readoutA.transientIndex ?? 0,
      readoutB.transientIndexFull ?? readoutB.transientIndex ?? 0,
      w,
      0.08,
      0.4
    ),
    tempo: {
      bpm: pickByWeight(readoutA.tempo?.bpm, readoutB.tempo?.bpm, w) || null,
      confidence: Math.max(readoutA.tempo?.confidence ?? 0, readoutB.tempo?.confidence ?? 0),
      feel: pickByWeight(readoutA.tempo?.feel, readoutB.tempo?.feel, w),
      note: "Tempo taken from the weighted parent — verify against both refs.",
      reliable: Boolean(
        pickByWeight(readoutA.tempo?.reliable, readoutB.tempo?.reliable, w) ||
          readoutA.tempo?.reliable ||
          readoutB.tempo?.reliable
      ),
    },
    pitch: {
      f0Hz: pickByWeight(readoutA.pitch?.f0Hz, readoutB.pitch?.f0Hz, w) || null,
      keyLabel: pickByWeight(readoutA.pitch?.keyLabel, readoutB.pitch?.keyLabel, w),
      register: pickByWeight(readoutA.pitch?.register, readoutB.pitch?.register, w),
      noteName: pickByWeight(readoutA.pitch?.noteName, readoutB.pitch?.noteName, w),
      keyConfidence: Math.max(
        readoutA.pitch?.keyConfidence ?? 0,
        readoutB.pitch?.keyConfidence ?? 0
      ),
      keyReliable: Boolean(
        pickByWeight(readoutA.pitch?.keyReliable, readoutB.pitch?.keyReliable, w) ||
          readoutA.pitch?.keyReliable ||
          readoutB.pitch?.keyReliable
      ),
      note: "Key/pitch taken from the weighted parent — prefer the clearer of the two refs.",
    },
    eqTargets: {
      mudHz: Math.round(
        contrastMerge(readoutA.eqTargets?.mudHz ?? 320, readoutB.eqTargets?.mudHz ?? 320, w, 40, 0.35)
      ),
      harshHz: Math.round(
        contrastMerge(
          readoutA.eqTargets?.harshHz ?? 3200,
          readoutB.eqTargets?.harshHz ?? 3200,
          w,
          200,
          0.35
        )
      ),
      presenceHz: Math.round(
        contrastMerge(
          readoutA.eqTargets?.presenceHz ?? 4500,
          readoutB.eqTargets?.presenceHz ?? 4500,
          w,
          200,
          0.35
        )
      ),
      deessHz: Math.round(
        contrastMerge(
          readoutA.eqTargets?.deessHz ?? 6500,
          readoutB.eqTargets?.deessHz ?? 6500,
          w,
          300,
          0.35
        )
      ),
      airHz: Math.round(
        contrastMerge(
          readoutA.eqTargets?.airHz ?? 11000,
          readoutB.eqTargets?.airHz ?? 11000,
          w,
          400,
          0.4
        )
      ),
    },
    master: {
      peakDb: dynamics.peakDb,
      rmsDb: dynamics.rmsDb,
      crestDb: dynamics.crestDb,
      lufsProxy,
      correlation: stereo.correlation,
      sideMidRatio: stereo.sideMidRatio,
      centroidHz: contrastMerge(
        readoutA.master?.centroidHz ?? readoutA.centroidFullHz ?? readoutA.centroidHz,
        readoutB.master?.centroidHz ?? readoutB.centroidFullHz ?? readoutB.centroidHz,
        w,
        200,
        0.45
      ),
      bands: bandsFullMix,
      bpm: pickByWeight(readoutA.tempo?.bpm, readoutB.tempo?.bpm, w) || null,
      keyLabel: pickByWeight(readoutA.pitch?.keyLabel, readoutB.pitch?.keyLabel, w),
      streamingTarget:
        readoutA.master?.streamingTarget ||
        "Aim integrated ≈ −14 LUFS / −1 dBTP for most DSPs (verify with a real meter).",
    },
  };
}

function leanLabel(nameA, nameB, w) {
  if (w < 0.4) return nameA;
  if (w > 0.6) return nameB;
  return "both";
}

/**
 * Build human notes from the Compare report + weight.
 */
function pullNotes(nameA, nameB, compare, w) {
  const notes = [];
  const lean = leanLabel(nameA, nameB, w);
  const pctA = Math.round((1 - w) * 100);
  const pctB = Math.round(w * 100);
  notes.push(
    lean === "both"
      ? `Balanced merge of “${nameA}” and “${nameB}” (${pctA}/${pctB}).`
      : `Hybrid leans toward “${lean}” (${pctA}% ${nameA} / ${pctB}% ${nameB}).`
  );

  const meaningful = (compare.metrics || []).filter((m) => m.sign !== 0);
  for (const m of meaningful.slice(0, 4)) {
    const toward =
      m.sign > 0
        ? `${nameB} reads ${m.value.toLowerCase()} on ${m.key.toLowerCase()}`
        : `${nameA} holds the other end on ${m.key.toLowerCase()}`;
    notes.push(`${toward} — hybrid keeps that contrast instead of averaging it away.`);
  }

  const hotBands = (compare.bands || [])
    .filter((b) => Math.abs(b.deltaDb) >= 2)
    .sort((a, b) => Math.abs(b.deltaDb) - Math.abs(a.deltaDb))
    .slice(0, 2);
  for (const b of hotBands) {
    const heavier = b.deltaDb > 0 ? nameB : nameA;
    notes.push(
      `${heavier} carries more ${b.label.toLowerCase()} (${b.lo}–${b.hi} Hz) — EQ target follows that side.`
    );
  }

  if (meaningful.length === 0 && hotBands.length === 0) {
    notes.push("These refs sit close — the hybrid fine-tunes shared traits rather than inventing new ones.");
  }

  notes.push("This is a target signature, not an audio morph. Print, then A/B both refs at matched loudness.");
  return notes;
}

/**
 * Build a full blended analysis result ready for the studio UI.
 * @param {{ name: string, result: { readout: object } }} entryA
 * @param {{ name: string, result: { readout: object } }} entryB
 * @param {{ weight?: number, pluginMap?: object, mode?: 'standard'|'deep', target?: string }} [opts]
 */
export function blendTracks(entryA, entryB, opts = {}) {
  const weight = opts.weight ?? 0.5;
  const mode = opts.mode || "standard";
  const pluginMap = opts.pluginMap || null;

  const readoutA = entryA.result?.readout;
  const readoutB = entryB.result?.readout;
  if (!readoutA || !readoutB) {
    throw new Error("Both tracks need a completed analysis before blending.");
  }

  const target = normalizeTarget(opts.target || readoutA.target || readoutB.target || "vocal");
  // B relative to A — same language as Compare tab
  const compare = compareMixes(readoutA, readoutB, { target });

  const readout = blendReadouts(readoutA, readoutB, weight);
  readout.instruments = detectInstruments(readout);
  readout.target = target;

  let traits = characterize(readout);
  const blendNotes = pullNotes(entryA.name, entryB.name, compare, weight);
  const blendFindings = blendNotes.slice(0, 4).map((text, i) => ({
    label: i === 0 ? "Merge" : "Contrast",
    text,
  }));
  traits = {
    ...traits,
    findings: [...blendFindings, ...(traits.findings || [])],
    summary: [...blendNotes.slice(0, 4), ...traits.summary],
  };

  const advice = pluginMap
    ? recommend(traits, pluginMap, "universal", readout, mode, target)
    : null;

  if (advice) {
    advice.blend = {
      a: entryA.name,
      b: entryB.name,
      weight,
      compare,
      notes: blendNotes,
    };
    if (advice.chain) {
      advice.chain.honesty =
        `Hybrid recreation of “${entryA.name}” × “${entryB.name}” — contrast-preserving merge of both measured signatures.`;
      const top = blendNotes.slice(0, 2).join(" ");
      advice.estimateNote = `Hybrid chain · ${Math.round((1 - weight) * 100)}/${Math.round(weight * 100)} · ${top}`;
    }
  }

  return {
    readout,
    traits: advice?.traits || traits,
    advice,
    mode,
    target,
    blendNotes,
    compare,
  };
}

export const BLEND_WEIGHTS = [
  { id: "a", label: "More like A", weight: 0.28 },
  { id: "even", label: "Balanced merge", weight: 0.5 },
  { id: "b", label: "More like B", weight: 0.72 },
];
