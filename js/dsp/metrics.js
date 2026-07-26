/**
 * Measurement layer — spectral, tone, dynamics, stereo, tempo, pitch.
 * Target regions estimate vocal / instrumental / full-mix character on a finished master
 * (or a provided stem). Not the true plugin chain.
 */

import { FFT_SIZE, hannWindow, magnitudeSpectrum } from "./fft.js";
import { estimateTempo } from "./tempo.js";
import { estimatePitchProfile } from "./pitch.js";
import { detectInstruments } from "./instruments.js";

export const BANDS = [
  { id: "sub", label: "Sub", lo: 20, hi: 60 },
  { id: "bass", label: "Bass", lo: 60, hi: 250 },
  { id: "low_mid", label: "Low Mid", lo: 250, hi: 500 },
  { id: "mid", label: "Mid", lo: 500, hi: 2000 },
  { id: "presence", label: "Presence", lo: 2000, hi: 4000 },
  { id: "brilliance", label: "Brilliance", lo: 4000, hi: 8000 },
  { id: "air", label: "Air", lo: 8000, hi: 12000 },
  { id: "top", label: "Top", lo: 12000, hi: 20000 },
];

/** Approximate band where lead vocals usually live on a finished mix. */
export const VOCAL_REGION = { lo: 200, hi: 8000 };

/** @typedef {'vocal' | 'instrumental' | 'full'} AnalysisTarget */

export const ANALYSIS_TARGETS = /** @type {const} */ (["vocal", "instrumental", "full"]);

/**
 * @param {string} [t]
 * @returns {AnalysisTarget}
 */
export function normalizeTarget(t) {
  const v = String(t || "vocal").toLowerCase();
  if (v === "instrumental" || v === "full") return v;
  return "vocal";
}

const TARGET_NOTES = {
  vocal:
    "Estimate of the vocal region on a finished master — not an isolated stem, not the true chain.",
  instrumental:
    "Estimate of the instrumental bed on a finished master — vocal presence attenuated. Upload an instrumental stem for higher accuracy.",
  full: "Full-mix measurement of the finished master — mix-bus and mastering guidance, not the true chain.",
  stem: "Measured from your uploaded stem — still a reconstruction of settings, not the original plugins.",
};

const EPS = 1e-12;
const HOP = FFT_SIZE / 4; // 75% overlap
/** Cap spectral analysis so long masters stay interactive (~45s window). */
const MAX_SPECTRUM_SEC = 45;
/** Soft ceiling on FFT frames — stride if denser. */
const MAX_SPECTRUM_FRAMES = 320;

function db(power) {
  return 10 * Math.log10(Math.max(power, EPS));
}

function bandPower(mag, sampleRate, lo, hi) {
  const binHz = sampleRate / FFT_SIZE;
  const i0 = Math.max(1, Math.floor(lo / binHz));
  const i1 = Math.min(mag.length - 1, Math.ceil(hi / binHz));
  let sum = 0;
  for (let i = i0; i <= i1; i++) sum += mag[i] * mag[i];
  return sum;
}

function bandDb(mag, sampleRate, lo, hi) {
  return db(bandPower(mag, sampleRate, lo, hi));
}

/**
 * Peak frequency (Hz) inside a band — local maximum with parabolic refine.
 * Avoids always latching the band edge when energy slopes.
 */
export function bandPeakHz(mag, sampleRate, lo, hi) {
  const binHz = sampleRate / FFT_SIZE;
  const i0 = Math.max(2, Math.floor(lo / binHz));
  const i1 = Math.min(mag.length - 2, Math.ceil(hi / binHz));
  if (i1 <= i0) return Math.round((lo + hi) / 2);

  let bestI = Math.round((i0 + i1) / 2);
  let best = -1;
  for (let i = i0; i <= i1; i++) {
    // Prefer true local peaks
    const isPeak = mag[i] >= mag[i - 1] && mag[i] >= mag[i + 1];
    const p = mag[i] * mag[i] * (isPeak ? 1.35 : 0.85);
    if (p > best) {
      best = p;
      bestI = i;
    }
  }

  // Parabolic interpolation around best bin
  let delta = 0;
  if (bestI > 0 && bestI < mag.length - 1) {
    const y0 = mag[bestI - 1];
    const y1 = mag[bestI];
    const y2 = mag[bestI + 1];
    const denom = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(denom) > 1e-12) delta = (y0 - y2) / denom;
  }

  const hz = (bestI + delta) * binHz;
  return Math.round(clamp(hz, lo, hi));
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Per-track EQ target centers from the measured spectrum.
 */
export function eqTargetsFromSpectrum(mag, sampleRate) {
  return {
    mudHz: bandPeakHz(mag, sampleRate, 180, 450),
    harshHz: bandPeakHz(mag, sampleRate, 2200, 4500),
    presenceHz: bandPeakHz(mag, sampleRate, 2800, 5500),
    deessHz: bandPeakHz(mag, sampleRate, 4500, 9500),
    airHz: bandPeakHz(mag, sampleRate, 9000, 14000),
  };
}

/**
 * Zero-pad (or truncate) a slice to exactly FFT_SIZE samples.
 */
function frameAt(channelData, offset) {
  const frame = new Float32Array(FFT_SIZE);
  const available = Math.min(FFT_SIZE, Math.max(0, channelData.length - offset));
  if (available > 0) frame.set(channelData.subarray(offset, offset + available));
  return frame;
}

/**
 * Average magnitude spectrum across overlapping Hann frames.
 * Long files use a mid-track window + frame stride so analysis stays snappy.
 */
export function averageSpectrum(channelData, sampleRate) {
  const window = hannWindow(FFT_SIZE);
  const accum = new Float64Array(FFT_SIZE / 2 + 1);

  let frames = 0;
  if (channelData.length < FFT_SIZE) {
    const mag = magnitudeSpectrum(frameAt(channelData, 0), window);
    for (let i = 0; i < mag.length; i++) accum[i] = mag[i];
    frames = 1;
  } else {
    const maxSamples = Math.round(sampleRate * MAX_SPECTRUM_SEC);
    let start = 0;
    let end = channelData.length;
    if (channelData.length > maxSamples) {
      // Skip early intro; analyze a representative mid-track slice
      start = Math.floor((channelData.length - maxSamples) * 0.22);
      end = start + maxSamples;
    }

    const lastStart = end - FFT_SIZE;
    const span = Math.max(0, lastStart - start);
    const approxFrames = Math.floor(span / HOP) + 1;
    const stride = Math.max(1, Math.ceil(approxFrames / MAX_SPECTRUM_FRAMES));

    for (let offset = start; offset <= lastStart; offset += HOP * stride) {
      const mag = magnitudeSpectrum(frameAt(channelData, offset), window);
      for (let i = 0; i < mag.length; i++) accum[i] += mag[i];
      frames += 1;
    }
    if (frames === 0) {
      const mag = magnitudeSpectrum(frameAt(channelData, start), window);
      for (let i = 0; i < mag.length; i++) accum[i] = mag[i];
      frames = 1;
    } else {
      for (let i = 0; i < accum.length; i++) accum[i] /= frames;
    }
  }

  return { mag: accum, sampleRate, frames, hop: HOP };
}

/**
 * Spectrum with bins outside the vocal region attenuated (not removed).
 * Keeps the measurement honest as an estimate of "where the vocal lives."
 */
export function vocalWeightedSpectrum(mag, sampleRate) {
  const binHz = sampleRate / FFT_SIZE;
  const weighted = new Float64Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    const hz = i * binHz;
    let w = 0.15;
    if (hz >= VOCAL_REGION.lo && hz <= VOCAL_REGION.hi) w = 1;
    else if (hz > VOCAL_REGION.hi && hz < 16000) w = 0.45;
    else if (hz >= 80 && hz < VOCAL_REGION.lo) w = 0.35;
    weighted[i] = mag[i] * w;
  }
  return weighted;
}

/**
 * Emphasize bed / rhythm / air; attenuate typical lead-vocal presence on a full master.
 */
export function instrumentalWeightedSpectrum(mag, sampleRate) {
  const binHz = sampleRate / FFT_SIZE;
  const weighted = new Float64Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    const hz = i * binHz;
    let w = 0.55;
    if (hz < 80) w = 1;
    else if (hz < 250) w = 1;
    else if (hz < 500) w = 0.9;
    else if (hz < 1500) w = 0.7;
    else if (hz < 5000) w = 0.28; // duck vocal presence pocket
    else if (hz < 9000) w = 0.95;
    else w = 1;
    weighted[i] = mag[i] * w;
  }
  return weighted;
}

/** Flat / full-mix weight (identity). */
export function fullWeightedSpectrum(mag) {
  return Float64Array.from(mag);
}

/**
 * @param {Float64Array | Float32Array} mag
 * @param {number} sampleRate
 * @param {AnalysisTarget} target
 */
export function regionWeightedSpectrum(mag, sampleRate, target) {
  const t = normalizeTarget(target);
  if (t === "instrumental") return instrumentalWeightedSpectrum(mag, sampleRate);
  if (t === "full") return fullWeightedSpectrum(mag);
  return vocalWeightedSpectrum(mag, sampleRate);
}

export function spectralBalance(mag, sampleRate) {
  const powers = BANDS.map((b) => bandPower(mag, sampleRate, b.lo, b.hi));
  const total = powers.reduce((a, p) => a + p, 0);
  const totalDb = db(total);
  return BANDS.map((b, i) => ({
    id: b.id,
    label: b.label,
    lo: b.lo,
    hi: b.hi,
    dbRelTotal: db(powers[i]) - totalDb,
  }));
}

export function spectralCentroidHz(mag, sampleRate) {
  const binHz = sampleRate / FFT_SIZE;
  let num = 0;
  let den = 0;
  for (let i = 1; i < mag.length; i++) {
    const p = mag[i] * mag[i];
    num += p * i * binHz;
    den += p;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Tone indices as dB ratios of named regions (estimate).
 */
export function toneIndices(mag, sampleRate) {
  return {
    air: bandDb(mag, sampleRate, 8000, 16000) - bandDb(mag, sampleRate, 200, 5000),
    sibilance: bandDb(mag, sampleRate, 5000, 10000) - bandDb(mag, sampleRate, 1000, 4000),
    harshness: bandDb(mag, sampleRate, 2500, 5000) - bandDb(mag, sampleRate, 200, 2000),
    mud: bandDb(mag, sampleRate, 200, 500) - bandDb(mag, sampleRate, 500, 2000),
  };
}

export function dynamics(channelData, sampleRate) {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < channelData.length; i++) {
    const x = Math.abs(channelData[i]);
    if (x > peak) peak = x;
    sumSq += channelData[i] * channelData[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, channelData.length));
  const peakDb = db(peak * peak);
  const rmsDb = db(rms * rms);
  const crestDb = peakDb - rmsDb;

  // ~400 ms blocks — honest short-term range, not LUFS
  const block = Math.max(1, Math.round(sampleRate * 0.4));
  let minBlock = Infinity;
  let maxBlock = -Infinity;
  let blocks = 0;
  for (let i = 0; i + block <= channelData.length; i += block) {
    let s = 0;
    for (let j = 0; j < block; j++) s += channelData[i + j] * channelData[i + j];
    const bDb = db(s / block);
    if (bDb < minBlock) minBlock = bDb;
    if (bDb > maxBlock) maxBlock = bDb;
    blocks += 1;
  }

  return {
    peakDb,
    rmsDb,
    crestDb,
    shortTermRangeDb:
      blocks > 0 && Number.isFinite(maxBlock - minBlock) ? maxBlock - minBlock : 0,
  };
}

export function stereoMetrics(left, right) {
  const n = Math.min(left.length, right.length);
  let sumL2 = 0;
  let sumR2 = 0;
  let sumLR = 0;
  let midEnergy = 0;
  let sideEnergy = 0;

  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    sumL2 += l * l;
    sumR2 += r * r;
    sumLR += l * r;
    const mid = 0.5 * (l + r);
    const side = 0.5 * (l - r);
    midEnergy += mid * mid;
    sideEnergy += side * side;
  }

  const denom = Math.sqrt(sumL2 * sumR2);
  const correlation = denom > 0 ? sumLR / denom : 1;
  const sideMidRatio = midEnergy > 0 ? sideEnergy / midEnergy : 0;

  return { correlation, sideMidRatio };
}

/**
 * Rough integrated loudness proxy (not true ITU BS.1770 LUFS).
 * Useful for relative comparison / streaming ballpark only.
 */
export function loudnessProxy(channelData) {
  let sum = 0;
  for (let i = 0; i < channelData.length; i++) sum += channelData[i] * channelData[i];
  const mean = sum / Math.max(1, channelData.length);
  const lufsProxy = db(mean) - 0.691; // rough K-weighting-ish offset
  return {
    lufsProxy,
    note: "Approximate loudness proxy — not certified LUFS. Use a real meter (Youlean) for delivery.",
  };
}

/** High-frequency transient density vs body — helps dial attack / saturation. */
export function transientIndex(mag, sampleRate) {
  const hi = bandDb(mag, sampleRate, 4000, 12000);
  const body = bandDb(mag, sampleRate, 200, 2000);
  return hi - body;
}

/**
 * Full readout for a decoded AudioBuffer.
 * @param {AudioBuffer} audioBuffer
 * @param {{ target?: AnalysisTarget, sourceKind?: 'estimate' | 'stem' }} [opts]
 */
export function measureBuffer(audioBuffer, opts = {}) {
  return measureFromChannels(audioBuffer, opts);
}

/**
 * Async measure with progress yields so the UI can breathe mid-analysis.
 * @param {AudioBuffer} audioBuffer
 * @param {(t: number) => void} [onProgress] 0–1 within measure stage
 * @param {{ target?: AnalysisTarget, sourceKind?: 'estimate' | 'stem' }} [opts]
 */
export async function measureBufferAsync(audioBuffer, onProgress, opts = {}) {
  const yieldMain = () =>
    new Promise((r) => {
      if (typeof scheduler !== "undefined" && scheduler.postTask) {
        scheduler.postTask(() => r(), { priority: "user-visible" });
      } else {
        setTimeout(r, 0);
      }
    });

  const target = normalizeTarget(opts.target);
  const sourceKind = opts.sourceKind === "stem" ? "stem" : "estimate";

  onProgress?.(0.05);
  await yieldMain();
  const partial = prepareChannels(audioBuffer);

  onProgress?.(0.2);
  await yieldMain();
  const { mag, frames, hop } = averageSpectrum(partial.mono, partial.sampleRate);

  onProgress?.(0.45);
  await yieldMain();
  // Stem uploads are already isolated — use flat weight for the primary target spectrum
  const primaryMag =
    sourceKind === "stem" ? fullWeightedSpectrum(mag) : regionWeightedSpectrum(mag, partial.sampleRate, target);
  const vocalMag = vocalWeightedSpectrum(mag, partial.sampleRate);
  const loud = loudnessProxy(partial.mono);
  const dyn = dynamics(partial.mono, partial.sampleRate);
  const stereo = stereoMetrics(partial.leftWin, partial.rightWin);

  onProgress?.(0.6);
  await yieldMain();
  const tempo = estimateTempo(partial.mono, partial.sampleRate);

  onProgress?.(0.8);
  await yieldMain();
  const pitch = estimatePitchProfile(partial.mono, partial.sampleRate, mag);
  const eqTargets = eqTargetsFromSpectrum(primaryMag, partial.sampleRate);

  onProgress?.(1);
  return buildReadout(partial, {
    mag,
    frames,
    hop,
    primaryMag,
    vocalMag,
    loud,
    dyn,
    stereo,
    tempo,
    pitch,
    eqTargets,
    target,
    sourceKind,
  });
}

/** Cap mono mix to ~60s so dynamics/tempo/pitch stay responsive on long masters. */
const MAX_MEASURE_SEC = 60;

function prepareChannels(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const maxLen = Math.min(left.length, Math.round(sampleRate * MAX_MEASURE_SEC));
  const start = left.length > maxLen ? Math.floor((left.length - maxLen) * 0.15) : 0;

  const mono = new Float32Array(maxLen);
  const leftWin = new Float32Array(maxLen);
  const rightWin = new Float32Array(maxLen);
  for (let i = 0; i < maxLen; i++) {
    const idx = start + i;
    const l = left[idx];
    const r = right[idx];
    leftWin[i] = l;
    rightWin[i] = r;
    mono[i] = 0.5 * (l + r);
  }

  return {
    sampleRate,
    durationSec: audioBuffer.duration,
    mono,
    leftWin,
    rightWin,
  };
}

function measureFromChannels(audioBuffer, opts = {}) {
  const target = normalizeTarget(opts.target);
  const sourceKind = opts.sourceKind === "stem" ? "stem" : "estimate";
  const partial = prepareChannels(audioBuffer);
  const { mag, frames, hop } = averageSpectrum(partial.mono, partial.sampleRate);
  const primaryMag =
    sourceKind === "stem" ? fullWeightedSpectrum(mag) : regionWeightedSpectrum(mag, partial.sampleRate, target);
  const vocalMag = vocalWeightedSpectrum(mag, partial.sampleRate);
  const loud = loudnessProxy(partial.mono);
  const dyn = dynamics(partial.mono, partial.sampleRate);
  const stereo = stereoMetrics(partial.leftWin, partial.rightWin);
  const tempo = estimateTempo(partial.mono, partial.sampleRate);
  const pitch = estimatePitchProfile(partial.mono, partial.sampleRate, mag);
  const eqTargets = eqTargetsFromSpectrum(primaryMag, partial.sampleRate);
  return buildReadout(partial, {
    mag,
    frames,
    hop,
    primaryMag,
    vocalMag,
    loud,
    dyn,
    stereo,
    tempo,
    pitch,
    eqTargets,
    target,
    sourceKind,
  });
}

function buildReadout(partial, parts) {
  const {
    mag,
    frames,
    hop,
    primaryMag,
    vocalMag,
    loud,
    dyn,
    stereo,
    tempo,
    pitch,
    eqTargets,
    target = "vocal",
    sourceKind = "estimate",
  } = parts;
  const { sampleRate, durationSec } = partial;
  const t = normalizeTarget(target);
  const primary = primaryMag || vocalMag;
  const note = sourceKind === "stem" ? TARGET_NOTES.stem : TARGET_NOTES[t];

  const readout = {
    estimate: sourceKind !== "stem",
    sourceKind,
    target: t,
    note,
    sampleRate,
    durationSec,
    frames,
    hop,
    fftSize: FFT_SIZE,
    bands: spectralBalance(primary, sampleRate),
    bandsFullMix: spectralBalance(mag, sampleRate),
    centroidHz: spectralCentroidHz(primary, sampleRate),
    centroidFullHz: spectralCentroidHz(mag, sampleRate),
    tone: toneIndices(primary, sampleRate),
    toneFull: toneIndices(mag, sampleRate),
    dynamics: dyn,
    stereo,
    loudness: loud,
    transientIndex: transientIndex(primary, sampleRate),
    transientIndexFull: transientIndex(mag, sampleRate),
    tempo,
    pitch,
    eqTargets,
    master: {
      peakDb: dyn.peakDb,
      rmsDb: dyn.rmsDb,
      crestDb: dyn.crestDb,
      lufsProxy: loud.lufsProxy,
      correlation: stereo.correlation,
      sideMidRatio: stereo.sideMidRatio,
      centroidHz: spectralCentroidHz(mag, sampleRate),
      bands: spectralBalance(mag, sampleRate),
      bpm: tempo.reliable ? tempo.bpm : null,
      keyLabel: pitch.keyLabel || null,
      relativeKey: pitch.relativeKey || null,
      streamingTarget: "Aim integrated ≈ −14 LUFS / −1 dBTP for most DSPs (verify with a real meter).",
    },
  };

  readout.instruments = detectInstruments(readout);
  return readout;
}
