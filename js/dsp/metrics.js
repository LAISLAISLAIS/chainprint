/**
 * Measurement layer — spectral, tone, dynamics, stereo, tempo, pitch.
 * All values are estimates of the vocal region on a finished master, not an isolated stem.
 */

import { FFT_SIZE, hannWindow, magnitudeSpectrum } from "./fft.js";
import { estimateTempo } from "./tempo.js";
import { estimatePitchProfile } from "./pitch.js";

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

const EPS = 1e-12;
const HOP = FFT_SIZE / 4; // 75% overlap

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
 * Peak frequency (Hz) inside a band — used to place EQ cuts per track.
 */
export function bandPeakHz(mag, sampleRate, lo, hi) {
  const binHz = sampleRate / FFT_SIZE;
  const i0 = Math.max(1, Math.floor(lo / binHz));
  const i1 = Math.min(mag.length - 1, Math.ceil(hi / binHz));
  let bestI = Math.round((i0 + i1) / 2);
  let best = -1;
  for (let i = i0; i <= i1; i++) {
    const p = mag[i] * mag[i];
    if (p > best) {
      best = p;
      bestI = i;
    }
  }
  return Math.round(bestI * binHz);
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
 * Short files still analyze (single padded frame).
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
    const lastStart = channelData.length - FFT_SIZE;
    for (let offset = 0; offset <= lastStart; offset += HOP) {
      const mag = magnitudeSpectrum(frameAt(channelData, offset), window);
      for (let i = 0; i < mag.length; i++) accum[i] += mag[i];
      frames += 1;
    }
    for (let i = 0; i < accum.length; i++) accum[i] /= frames;
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
 * Label everywhere in UI: estimate of vocal region on a finished master.
 */
export function measureBuffer(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mono[i] = 0.5 * (left[i] + right[i]);
  }

  const { mag, frames, hop } = averageSpectrum(mono, sampleRate);
  const vocalMag = vocalWeightedSpectrum(mag, sampleRate);
  const loud = loudnessProxy(mono);
  const dyn = dynamics(mono, sampleRate);
  const stereo = stereoMetrics(left, right);
  const tempo = estimateTempo(mono, sampleRate);
  const pitch = estimatePitchProfile(mono, sampleRate, mag);
  const eqTargets = eqTargetsFromSpectrum(vocalMag, sampleRate);

  return {
    estimate: true,
    note: "Estimate of the vocal region on a finished master — not an isolated stem, not the true chain.",
    sampleRate,
    durationSec: audioBuffer.duration,
    frames,
    hop,
    fftSize: FFT_SIZE,
    bands: spectralBalance(vocalMag, sampleRate),
    bandsFullMix: spectralBalance(mag, sampleRate),
    centroidHz: spectralCentroidHz(vocalMag, sampleRate),
    centroidFullHz: spectralCentroidHz(mag, sampleRate),
    tone: toneIndices(vocalMag, sampleRate),
    toneFull: toneIndices(mag, sampleRate),
    dynamics: dyn,
    stereo,
    loudness: loud,
    transientIndex: transientIndex(vocalMag, sampleRate),
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
      bpm: tempo.bpm,
      keyLabel: pitch.keyLabel,
      streamingTarget: "Aim integrated ≈ −14 LUFS / −1 dBTP for most DSPs (verify with a real meter).",
    },
  };
}
