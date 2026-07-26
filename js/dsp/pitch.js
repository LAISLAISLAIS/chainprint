/**
 * Pitch / key estimates for mix analysis.
 *
 * Key: multi-frame HPCP-style chromagram + Krumhansl-Kessler & Temperley
 *      profile correlation (K-S algorithm). Confidence requires a clear
 *      gap over the runner-up — otherwise we mark unreliable.
 *
 * F0 / register: YIN-style difference function on mid-band frames
 *      (vocal-ish body), median of voiced estimates.
 *
 * On a finished master these are mix-level estimates — not a stem tuner.
 * Refs: Krumhansl & Schmuckler; Temperley (1999); de Cheveigné & Kawahara YIN.
 */

import { FFT_SIZE, hannWindow, magnitudeSpectrum } from "./fft.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Krumhansl-Kessler (cognitive) — solid on pop. */
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Temperley (1999) — less minor bias, good on tonal pop/rock. */
const TEMP_MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const TEMP_MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

const F0_MIN = 80;
const F0_MAX = 480;
const MAX_ANALYZE_SEC = 50;
const KEY_CONF_MIN = 0.38;
const KEY_GAP_MIN = 0.035;

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

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pearson(a, b) {
  let ma = 0;
  let mb = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / (Math.sqrt(da * db) + 1e-12);
}

/**
 * YIN difference function F0 for one frame.
 */
function yinF0(frame, sampleRate) {
  const n = frame.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / F0_MAX));
  const tauMax = Math.min(Math.floor(sampleRate / F0_MIN), Math.floor(n / 2) - 1);
  if (tauMax <= tauMin) return null;

  // Remove DC
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;

  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tau; i++) {
      const delta = frame[i] - mean - (frame[i + tau] - mean);
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // Cumulative mean normalized difference
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  const threshold = 0.15;
  let tauBest = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      tauBest = tau;
      break;
    }
  }
  if (tauBest < 0) {
    // Fallback: absolute minimum in range
    let minV = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < minV) {
        minV = cmnd[tau];
        tauBest = tau;
      }
    }
    if (minV > 0.45) return null;
  }

  // Parabolic interpolation
  let betterTau = tauBest;
  if (tauBest > 1 && tauBest < tauMax) {
    const s0 = cmnd[tauBest - 1];
    const s1 = cmnd[tauBest];
    const s2 = cmnd[tauBest + 1];
    const denom = 2 * (2 * s1 - s0 - s2);
    if (Math.abs(denom) > 1e-12) betterTau = tauBest + (s0 - s2) / denom;
  }

  const conf = clamp(1 - cmnd[tauBest], 0, 1);
  return { f0: sampleRate / betterTau, conf };
}

/**
 * Band-limited frame for vocal-ish F0 (removes sub kick & extreme air).
 */
function bandLimit(frame, sampleRate, lo = 90, hi = 1200) {
  // Simple one-pole HPF + LPF approximation in time domain
  const out = new Float32Array(frame.length);
  const rcH = 1 / (2 * Math.PI * lo);
  const rcL = 1 / (2 * Math.PI * hi);
  const dt = 1 / sampleRate;
  const aH = rcH / (rcH + dt);
  const aL = dt / (rcL + dt);
  let prevIn = frame[0];
  let prevHp = 0;
  let prevLp = 0;
  for (let i = 0; i < frame.length; i++) {
    const hp = aH * (prevHp + frame[i] - prevIn);
    prevIn = frame[i];
    prevHp = hp;
    prevLp += aL * (hp - prevLp);
    out[i] = prevLp;
  }
  return out;
}

export function estimateF0(mono, sampleRate) {
  const frameLen = Math.min(2048, Math.round(sampleRate * 0.045));
  const hop = Math.round(frameLen * 0.4);
  const start = Math.min(mono.length, Math.round(sampleRate * 0.4));
  const end = Math.min(mono.length, start + Math.round(sampleRate * MAX_ANALYZE_SEC));

  const f0s = [];
  const confs = [];
  for (let off = start; off + frameLen <= end; off += hop) {
    const raw = mono.subarray(off, off + frameLen);
    // Energy gate — skip near-silence
    let e = 0;
    for (let i = 0; i < raw.length; i++) e += raw[i] * raw[i];
    if (e / raw.length < 1e-7) continue;

    const frame = bandLimit(raw, sampleRate);
    const hit = yinF0(frame, sampleRate);
    if (hit && hit.conf > 0.35) {
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
      reliable: false,
    };
  }

  const confidence = median(confs) || 0;
  let register = "mid";
  if (f0 < 165) register = "low";
  else if (f0 < 270) register = "mid";
  else register = "high";

  return {
    f0Hz: Math.round(f0 * 10) / 10,
    noteName: midiToNoteName(hzToMidi(f0)),
    register,
    confidence: Math.round(confidence * 100) / 100,
    voicedFrames: f0s.length,
    reliable: f0s.length >= 8 && confidence >= 0.4,
  };
}

/**
 * Accumulate chromagram from spectral peaks across frames (HPCP-ish).
 * Peak-picking reduces percussive broadband smear that breaks key detection.
 */
export function accumulateChromagram(mono, sampleRate) {
  const window = hannWindow(FFT_SIZE);
  const chroma = new Float64Array(12);
  const hop = Math.round(FFT_SIZE * 0.5);
  const start = Math.min(mono.length, Math.round(sampleRate * 0.35));
  const end = Math.min(mono.length, start + Math.round(sampleRate * MAX_ANALYZE_SEC));
  const binHz = sampleRate / FFT_SIZE;
  let frames = 0;

  for (let off = start; off + FFT_SIZE <= end; off += hop) {
    const frame = new Float32Array(FFT_SIZE);
    frame.set(mono.subarray(off, off + FFT_SIZE));
    const mag = magnitudeSpectrum(frame, window);

    // Local peak pick in harmonic range
    const i0 = Math.max(2, Math.floor(80 / binHz));
    const i1 = Math.min(mag.length - 2, Math.ceil(4500 / binHz));
    for (let i = i0; i <= i1; i++) {
      if (!(mag[i] > mag[i - 1] && mag[i] >= mag[i + 1])) continue;
      // Relative prominence vs neighbors
      const floor = 0.5 * (mag[i - 1] + mag[i + 1]);
      const height = mag[i] - floor;
      if (height <= 0) continue;

      const hz = i * binHz;
      // Harmonic / tonal band weight — de-emphasize kick rumble & sibilance
      let w = 1;
      if (hz < 120) w = 0.35;
      else if (hz < 250) w = 0.75;
      else if (hz <= 2000) w = 1.35;
      else if (hz <= 3500) w = 0.9;
      else w = 0.45;

      const midi = hzToMidi(hz);
      if (!Number.isFinite(midi)) continue;
      // Soft bin: distribute across neighboring pitch classes
      const pcFloat = ((midi % 12) + 12) % 12;
      const pc0 = Math.floor(pcFloat) % 12;
      const pc1 = (pc0 + 1) % 12;
      const frac = pcFloat - Math.floor(pcFloat);
      const power = mag[i] * mag[i] * w;
      chroma[pc0] += power * (1 - frac);
      chroma[pc1] += power * frac;
    }
    frames += 1;
    if (frames >= 90) break;
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
  return { chroma, frames };
}

/** Legacy helper kept for callers that pass a precomputed mag. */
export function chromagramFromSpectrum(mag, sampleRate) {
  const chroma = new Float64Array(12);
  const hzPerBin = sampleRate / FFT_SIZE;
  for (let i = 2; i < mag.length - 1; i++) {
    if (!(mag[i] > mag[i - 1] && mag[i] >= mag[i + 1])) continue;
    const hz = i * hzPerBin;
    if (hz < 80 || hz > 4500) continue;
    const midi = hzToMidi(hz);
    if (!Number.isFinite(midi)) continue;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    const w = hz >= 120 && hz <= 2000 ? 1.3 : 0.7;
    chroma[pc] += mag[i] * mag[i] * w;
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
  return chroma;
}

function scoreKey(chroma, profile, root) {
  const rotated = new Float64Array(12);
  for (let i = 0; i < 12; i++) rotated[i] = profile[(i - root + 12) % 12];
  return pearson(chroma, rotated);
}

export function estimateKeyFromChroma(chroma) {
  const results = [];

  for (let root = 0; root < 12; root++) {
    const scores = [
      scoreKey(chroma, KK_MAJOR, root),
      scoreKey(chroma, TEMP_MAJOR, root),
      scoreKey(chroma, KK_MINOR, root),
      scoreKey(chroma, TEMP_MINOR, root),
    ];
    // Blend cognitive + corpus profiles
    const maj = 0.45 * scores[0] + 0.55 * scores[1];
    const min = 0.45 * scores[2] + 0.55 * scores[3];
    results.push({ key: NOTE_NAMES[root], mode: "major", score: maj });
    results.push({ key: NOTE_NAMES[root], mode: "minor", score: min });
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  const second = results[1];
  const gap = best.score - (second?.score ?? 0);
  const confidence = clamp(best.score, 0, 1);
  const reliable = confidence >= KEY_CONF_MIN && gap >= KEY_GAP_MIN;

  return {
    key: best.key,
    mode: best.mode,
    label: `${best.key} ${best.mode}`,
    confidence: Math.round(confidence * 100) / 100,
    gap: Math.round(gap * 1000) / 1000,
    reliable,
    runnerUp: second ? `${second.key} ${second.mode}` : null,
    top: results.slice(0, 3).map((r) => ({
      label: `${r.key} ${r.mode}`,
      score: Math.round(r.score * 1000) / 1000,
    })),
  };
}

/**
 * Full pitch profile for a mono buffer.
 * Prefer multi-frame HPCP over a single averaged spectrum.
 */
export function estimatePitchProfile(mono, sampleRate, _magUnused = null) {
  const f0 = estimateF0(mono, sampleRate);
  const { chroma, frames } = accumulateChromagram(mono, sampleRate);
  const key = estimateKeyFromChroma(chroma);

  let note;
  if (key.reliable && f0.reliable) {
    note = `Key ${key.label} · lead ~${f0.f0Hz} Hz (${f0.register}). Mix-level estimate — verify on a stem if critical.`;
  } else if (key.reliable) {
    note = `Key ${key.label} (conf ${key.confidence}). F0 unclear on this mix — register from tone only.`;
  } else if (f0.reliable) {
    note = `Lead register ~${f0.f0Hz} Hz (${f0.register}). Key ambiguous${
      key.runnerUp ? ` (${key.label} vs ${key.runnerUp})` : ""
    } — don’t lock Auto-Tune scale from this alone.`;
  } else {
    note =
      "Couldn’t lock a confident key/BPM-independent pitch read on this clip — upload a clearer section or set key manually.";
  }

  return {
    f0Hz: f0.reliable || f0.f0Hz ? f0.f0Hz : null,
    noteName: f0.noteName,
    register: f0.register,
    f0Confidence: f0.confidence,
    voicedFrames: f0.voicedFrames,
    f0Reliable: f0.reliable,
    key: key.reliable ? key.key : null,
    mode: key.reliable ? key.mode : null,
    keyLabel: key.reliable ? key.label : null,
    keyConfidence: key.confidence,
    keyGap: key.gap,
    keyReliable: key.reliable,
    keyRunnerUp: key.runnerUp,
    keyCandidates: key.top,
    chromaFrames: frames,
    note,
  };
}
