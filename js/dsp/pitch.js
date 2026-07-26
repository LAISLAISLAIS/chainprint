/**
 * Pitch / key estimates for mix analysis.
 * - f0: median autocorrelation pitch in the vocal body band (not Auto-Tune)
 * - key: chroma template match (Krumhansl-Schmuckler) on averaged spectrum
 *
 * On a finished master these are estimates of the dominant tonal center /
 * lead register — not a stem-isolated tuner.
 */

import { FFT_SIZE, hannWindow, magnitudeSpectrum } from "./fft.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Krumhansl-Kessler key profiles */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const F0_MIN = 75;
const F0_MAX = 520;
const MAX_ANALYZE_SEC = 40;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function midiToNoteName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * Normalized autocorrelation F0 for one frame. Returns null if unvoiced.
 */
function frameF0(frame, sampleRate) {
  const n = frame.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;

  let energy = 0;
  for (let i = 0; i < n; i++) {
    const x = frame[i] - mean;
    energy += x * x;
  }
  if (energy / n < 1e-8) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / F0_MAX));
  const tauMax = Math.min(Math.floor(sampleRate / F0_MIN), n - 2);
  if (tauMax <= tauMin) return null;

  let bestTau = tauMin;
  let bestR = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    const lim = n - tau;
    for (let i = 0; i < lim; i++) {
      const a = frame[i] - mean;
      const b = frame[i + tau] - mean;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const r = num / (Math.sqrt(denA * denB) + 1e-12);
    if (r > bestR) {
      bestR = r;
      bestTau = tau;
    }
  }

  if (bestR < 0.35) return null;
  return { f0: sampleRate / bestTau, conf: bestR };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Estimate lead-vocal register (median F0) from voiced frames.
 */
export function estimateF0(mono, sampleRate) {
  const frameLen = Math.min(2048, Math.round(sampleRate * 0.04));
  const hop = Math.round(frameLen / 2);
  const start = Math.min(mono.length, Math.round(sampleRate * 0.5));
  const end = Math.min(mono.length, start + Math.round(sampleRate * MAX_ANALYZE_SEC));

  const f0s = [];
  const confs = [];
  for (let off = start; off + frameLen <= end; off += hop) {
    const frame = mono.subarray(off, off + frameLen);
    // Mild pre-emphasis toward vocal body: simple 1-zero HPF-ish
    const buf = new Float32Array(frameLen);
    buf[0] = frame[0];
    for (let i = 1; i < frameLen; i++) buf[i] = frame[i] - 0.95 * frame[i - 1];
    const hit = frameF0(buf, sampleRate);
    if (hit) {
      f0s.push(hit.f0);
      confs.push(hit.conf);
    }
  }

  const f0 = median(f0s);
  if (!f0) {
    return {
      f0Hz: null,
      noteName: null,
      register: "unknown",
      confidence: 0,
      voicedFrames: 0,
    };
  }

  const confidence = median(confs) || 0;
  let register = "mid";
  if (f0 < 160) register = "low";
  else if (f0 < 260) register = "mid";
  else register = "high";

  return {
    f0Hz: Math.round(f0 * 10) / 10,
    noteName: midiToNoteName(hzToMidi(f0)),
    register,
    confidence: Math.round(confidence * 100) / 100,
    voicedFrames: f0s.length,
  };
}

function corr(a, b) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / (Math.sqrt(da * db) + 1e-12);
}

/**
 * Build a 12-bin chromagram from an averaged magnitude spectrum.
 */
export function chromagramFromSpectrum(mag, sampleRate) {
  const chroma = new Float64Array(12);
  const hzPerBin = sampleRate / FFT_SIZE;

  for (let i = 1; i < mag.length; i++) {
    const hz = i * hzPerBin;
    if (hz < 60 || hz > 5000) continue;
    const midi = hzToMidi(hz);
    if (!Number.isFinite(midi)) continue;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    const p = mag[i] * mag[i];
    // Weight midrange a bit more (vocal / harmonic body)
    const w = hz >= 120 && hz <= 2000 ? 1.25 : 0.85;
    chroma[pc] += p * w;
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
  return chroma;
}

export function estimateKeyFromChroma(chroma) {
  let best = { key: null, mode: null, score: -Infinity };

  for (let root = 0; root < 12; root++) {
    const rotatedMaj = new Float64Array(12);
    const rotatedMin = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      rotatedMaj[i] = MAJOR_PROFILE[(i - root + 12) % 12];
      rotatedMin[i] = MINOR_PROFILE[(i - root + 12) % 12];
    }
    const sMaj = corr(chroma, rotatedMaj);
    const sMin = corr(chroma, rotatedMin);
    if (sMaj > best.score) best = { key: NOTE_NAMES[root], mode: "major", score: sMaj };
    if (sMin > best.score) best = { key: NOTE_NAMES[root], mode: "minor", score: sMin };
  }

  return {
    key: best.key,
    mode: best.mode,
    label: best.key ? `${best.key} ${best.mode}` : null,
    confidence: clamp(best.score, 0, 1),
  };
}

/**
 * Full pitch profile for a mono buffer (+ optional precomputed mag spectrum).
 */
export function estimatePitchProfile(mono, sampleRate, mag = null) {
  const f0 = estimateF0(mono, sampleRate);

  let chroma;
  if (mag) {
    chroma = chromagramFromSpectrum(mag, sampleRate);
  } else {
    // Lightweight average spectrum for key only
    const window = hannWindow(FFT_SIZE);
    const accum = new Float64Array(FFT_SIZE / 2 + 1);
    const hop = FFT_SIZE / 2;
    const start = Math.min(mono.length, Math.round(sampleRate * 0.5));
    const end = Math.min(mono.length, start + Math.round(sampleRate * MAX_ANALYZE_SEC));
    let frames = 0;
    for (let off = start; off + FFT_SIZE <= end; off += hop) {
      const frame = new Float32Array(FFT_SIZE);
      frame.set(mono.subarray(off, off + FFT_SIZE));
      const m = magnitudeSpectrum(frame, window);
      for (let i = 0; i < m.length; i++) accum[i] += m[i];
      frames += 1;
      if (frames >= 48) break;
    }
    if (frames > 0) for (let i = 0; i < accum.length; i++) accum[i] /= frames;
    chroma = chromagramFromSpectrum(accum, sampleRate);
  }

  const key = estimateKeyFromChroma(chroma);

  return {
    f0Hz: f0.f0Hz,
    noteName: f0.noteName,
    register: f0.register,
    f0Confidence: f0.confidence,
    voicedFrames: f0.voicedFrames,
    key: key.key,
    mode: key.mode,
    keyLabel: key.label,
    keyConfidence: Math.round(key.confidence * 100) / 100,
    note:
      f0.f0Hz || key.label
        ? "Pitch/key from mix estimate — verify with a tuner on the vocal stem when possible."
        : "Couldn’t lock pitch/key on this clip.",
  };
}
