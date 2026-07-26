/**
 * Blend two measured mix signatures into one hybrid target.
 * Used to recreate a vocal that sits between (or combines) two references.
 */

import { characterize, recommend } from "./recommend.js";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpTone(a, b, t) {
  return {
    air: lerp(a.air, b.air, t),
    sibilance: lerp(a.sibilance, b.sibilance, t),
    harshness: lerp(a.harshness, b.harshness, t),
    mud: lerp(a.mud, b.mud, t),
  };
}

function lerpBands(a = [], b = [], t) {
  const byId = new Map(b.map((x) => [x.id || x.label, x]));
  return a.map((band) => {
    const other = byId.get(band.id || band.label) || band;
    return {
      ...band,
      dbRelTotal: lerp(band.dbRelTotal, other.dbRelTotal, t),
    };
  });
}

function lerpDynamics(a, b, t) {
  return {
    peakDb: lerp(a.peakDb, b.peakDb, t),
    rmsDb: lerp(a.rmsDb, b.rmsDb, t),
    crestDb: lerp(a.crestDb, b.crestDb, t),
    shortTermRangeDb: lerp(a.shortTermRangeDb, b.shortTermRangeDb, t),
  };
}

function lerpStereo(a, b, t) {
  return {
    correlation: lerp(a.correlation, b.correlation, t),
    sideMidRatio: lerp(a.sideMidRatio, b.sideMidRatio, t),
  };
}

/**
 * Interpolate two readouts. t=0 → A, t=1 → B, t=0.5 → even blend.
 * @param {object} readoutA
 * @param {object} readoutB
 * @param {number} [t]
 */
export function blendReadouts(readoutA, readoutB, t = 0.5) {
  const w = Math.max(0, Math.min(1, t));
  const dynamics = lerpDynamics(readoutA.dynamics, readoutB.dynamics, w);
  const stereo = lerpStereo(readoutA.stereo, readoutB.stereo, w);
  const loudA = readoutA.loudness?.lufsProxy ?? readoutA.dynamics.rmsDb;
  const loudB = readoutB.loudness?.lufsProxy ?? readoutB.dynamics.rmsDb;
  const lufsProxy = lerp(loudA, loudB, w);
  const bands = lerpBands(readoutA.bands, readoutB.bands, w);
  const bandsFullMix = lerpBands(
    readoutA.bandsFullMix || readoutA.bands,
    readoutB.bandsFullMix || readoutB.bands,
    w
  );

  return {
    estimate: true,
    blend: true,
    blendWeight: w,
    note: "Hybrid target from two references — interpolate settings, then A/B both sources by ear.",
    sampleRate: readoutA.sampleRate || readoutB.sampleRate,
    durationSec: lerp(readoutA.durationSec || 0, readoutB.durationSec || 0, w),
    frames: Math.round(lerp(readoutA.frames || 0, readoutB.frames || 0, w)),
    hop: readoutA.hop || readoutB.hop,
    fftSize: readoutA.fftSize || readoutB.fftSize,
    bands,
    bandsFullMix,
    centroidHz: lerp(readoutA.centroidHz, readoutB.centroidHz, w),
    centroidFullHz: lerp(
      readoutA.centroidFullHz ?? readoutA.centroidHz,
      readoutB.centroidFullHz ?? readoutB.centroidHz,
      w
    ),
    tone: lerpTone(readoutA.tone, readoutB.tone, w),
    toneFull: lerpTone(readoutA.toneFull || readoutA.tone, readoutB.toneFull || readoutB.tone, w),
    dynamics,
    stereo,
    loudness: {
      lufsProxy,
      note: readoutA.loudness?.note || "Approximate loudness proxy — not certified LUFS.",
    },
    transientIndex: lerp(readoutA.transientIndex ?? 0, readoutB.transientIndex ?? 0, w),
    master: {
      peakDb: dynamics.peakDb,
      rmsDb: dynamics.rmsDb,
      crestDb: dynamics.crestDb,
      lufsProxy,
      correlation: stereo.correlation,
      sideMidRatio: stereo.sideMidRatio,
      centroidHz: lerp(
        readoutA.master?.centroidHz ?? readoutA.centroidFullHz ?? readoutA.centroidHz,
        readoutB.master?.centroidHz ?? readoutB.centroidFullHz ?? readoutB.centroidHz,
        w
      ),
      bands: bandsFullMix,
      streamingTarget:
        readoutA.master?.streamingTarget ||
        "Aim integrated ≈ −14 LUFS / −1 dBTP for most DSPs (verify with a real meter).",
    },
  };
}

function pullNotes(nameA, nameB, readoutA, readoutB, w) {
  const notes = [];
  const lean = w < 0.4 ? nameA : w > 0.6 ? nameB : "both evenly";
  notes.push(`Blend leans toward ${lean} (${Math.round((1 - w) * 100)}% / ${Math.round(w * 100)}%).`);

  const dAir = readoutB.tone.air - readoutA.tone.air;
  if (Math.abs(dAir) > 2) {
    notes.push(
      dAir > 0
        ? `${nameB} carries more air — shelf sits between the two.`
        : `${nameA} carries more air — shelf sits between the two.`
    );
  }
  const dCrest = readoutB.dynamics.crestDb - readoutA.dynamics.crestDb;
  if (Math.abs(dCrest) > 1.5) {
    notes.push(
      dCrest < 0
        ? `${nameB} is denser (lower crest) — compression leans that way.`
        : `${nameA} is denser (lower crest) — compression leans that way.`
    );
  }
  const dSib = readoutB.tone.sibilance - readoutA.tone.sibilance;
  if (Math.abs(dSib) > 2) {
    notes.push("Sibilance differs — de-ess to the hotter of the two references, then ease back.");
  }
  const dWidth = readoutB.stereo.sideMidRatio - readoutA.stereo.sideMidRatio;
  if (Math.abs(dWidth) > 0.08) {
    notes.push("Stereo width differs — keep the lead centered; put the wider image on FX / doubles.");
  }
  notes.push("This is a target signature, not an audio morph. Print, then A/B both refs at matched loudness.");
  return notes;
}

/**
 * Build a full blended analysis result ready for the studio UI.
 * @param {{ name: string, result: { readout: object } }} entryA
 * @param {{ name: string, result: { readout: object } }} entryB
 * @param {{ weight?: number, pluginMap?: object, mode?: 'standard'|'deep' }} [opts]
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

  const readout = blendReadouts(readoutA, readoutB, weight);
  let traits = characterize(readout);
  const blendNotes = pullNotes(entryA.name, entryB.name, readoutA, readoutB, weight);
  traits = {
    ...traits,
    summary: [...blendNotes, ...traits.summary],
  };

  const advice = pluginMap
    ? recommend(traits, pluginMap, "universal", readout, mode)
    : null;

  if (advice) {
    advice.blend = {
      a: entryA.name,
      b: entryB.name,
      weight,
      notes: blendNotes,
    };
    if (advice.chain) {
      advice.chain.honesty =
        `Hybrid recreation of “${entryA.name}” × “${entryB.name}” — settings sit between both measured signatures.`;
      advice.estimateNote = `Combination mix · ${Math.round((1 - weight) * 100)}/${Math.round(weight * 100)} · refine by ear against both refs.`;
    }
  }

  return {
    readout,
    traits: advice?.traits || traits,
    advice,
    mode,
    blendNotes,
  };
}

export const BLEND_WEIGHTS = [
  { id: "a", label: "More A", weight: 0.28 },
  { id: "even", label: "Even", weight: 0.5 },
  { id: "b", label: "More B", weight: 0.72 },
];
