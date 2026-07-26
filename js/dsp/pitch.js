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

/** Essentia bgate (BeatPort-derived, gated) — strong maj/min third contrast. */
const BGATE_MAJOR = [1.0, 0.0, 0.42, 0.0, 0.53, 0.37, 0.0, 0.77, 0.0, 0.38, 0.21, 0.3];
const BGATE_MINOR = [1.0, 0.0, 0.36, 0.39, 0.0, 0.38, 0.0, 0.74, 0.27, 0.0, 0.42, 0.23];

/** Essentia edma — electronic / contemporary corpus. */
const EDMA_MAJOR = [1.0, 0.29, 0.5, 0.4, 0.6, 0.56, 0.32, 0.8, 0.31, 0.45, 0.42, 0.39];
const EDMA_MINOR = [1.0, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32];

const F0_MIN = 80;
const F0_MAX = 480;
const MAX_ANALYZE_SEC = 50;
const KEY_CONF_MIN = 0.35;
const KEY_GAP_MIN = 0.025;

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
      // Log-ish compression so drums don't drown harmonic content
      const power = Math.log1p(mag[i] * mag[i] * 40) * w;
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

/**
 * Relative major/minor (same key signature).
 * C major ↔ A minor, G major ↔ E minor, etc.
 */
export function relativeKey(key, mode) {
  const i = NOTE_NAMES.indexOf(key);
  if (i < 0 || !mode) return null;
  if (mode === "major") {
    const rel = NOTE_NAMES[(i + 9) % 12];
    return { key: rel, mode: "minor", label: `${rel} minor` };
  }
  if (mode === "minor") {
    const rel = NOTE_NAMES[(i + 3) % 12];
    return { key: rel, mode: "major", label: `${rel} major` };
  }
  return null;
}

export { NOTE_NAMES };

function scoreKey(chroma, profile, root) {
  const rotated = new Float64Array(12);
  for (let i = 0; i < 12; i++) rotated[i] = profile[(i - root + 12) % 12];
  return pearson(chroma, rotated);
}

/** maj3 vs min3 energy at a root — positive favors major. */
function thirdBias(chroma, root) {
  const maj3 = chroma[(root + 4) % 12];
  const min3 = chroma[(root + 3) % 12];
  return (maj3 - min3) / (maj3 + min3 + 1e-9);
}

function tonicWeight(chroma, root) {
  return chroma[root] + 0.55 * chroma[(root + 7) % 12];
}

/**
 * Relative major/minor pairs share nearly the same pitch set.
 * When both score close, decide from tonic gravity + third quality.
 */
function resolveRelativePair(results, chroma) {
  if (results.length < 2) return results;
  const best = results[0];
  const rel = relativeKey(best.key, best.mode);
  if (!rel) return results;
  const rivalIdx = results.findIndex((r) => r.key === rel.key && r.mode === rel.mode);
  if (rivalIdx < 0) return results;
  const rival = results[rivalIdx];
  const gap = best.score - rival.score;
  if (gap > 0.07) return results;

  const rootBest = NOTE_NAMES.indexOf(best.key);
  const rootRival = NOTE_NAMES.indexOf(rival.key);
  const scoreCandidate = (root, mode) => {
    const third = thirdBias(chroma, root);
    const tonic = tonicWeight(chroma, root);
    // Prefer matching third quality; weight tonic so the real home key wins
    const thirdFit = mode === "major" ? third : -third;
    return tonic * 1.25 + thirdFit * 0.85;
  };

  const bestFit = scoreCandidate(rootBest, best.mode);
  const rivalFit = scoreCandidate(rootRival, rival.mode);
  if (rivalFit > bestFit + 0.02) {
    // Keep rival first; leave remaining list sorted by score
    const rest = results.filter((r) => !(r.key === rival.key && r.mode === rival.mode));
    return [rival, ...rest];
  }
  return results;
}

export function estimateKeyFromChroma(chroma) {
  const results = [];

  for (let root = 0; root < 12; root++) {
    const kkMaj = scoreKey(chroma, KK_MAJOR, root);
    const tmpMaj = scoreKey(chroma, TEMP_MAJOR, root);
    const bgMaj = scoreKey(chroma, BGATE_MAJOR, root);
    const edMaj = scoreKey(chroma, EDMA_MAJOR, root);
    const kkMin = scoreKey(chroma, KK_MINOR, root);
    const tmpMin = scoreKey(chroma, TEMP_MINOR, root);
    const bgMin = scoreKey(chroma, BGATE_MINOR, root);
    const edMin = scoreKey(chroma, EDMA_MINOR, root);

    // Weight contemporary / gated profiles higher — they separate maj/min better
    let maj = 0.15 * kkMaj + 0.2 * tmpMaj + 0.35 * bgMaj + 0.3 * edMaj;
    let min = 0.15 * kkMin + 0.2 * tmpMin + 0.35 * bgMin + 0.3 * edMin;

    // Soft third-quality nudge so minor isn't drowned by relative major
    const third = thirdBias(chroma, root);
    maj += Math.max(0, third) * 0.045;
    min += Math.max(0, -third) * 0.055;

    results.push({ key: NOTE_NAMES[root], mode: "major", score: maj });
    results.push({ key: NOTE_NAMES[root], mode: "minor", score: min });
  }

  results.sort((a, b) => b.score - a.score);
  const ranked = resolveRelativePair(results, chroma);
  const best = ranked[0];
  const second = ranked[1];
  const gap = Math.abs(best.score - (second?.score ?? 0));
  const confidence = clamp(best.score, 0, 1);
  const reliable = confidence >= KEY_CONF_MIN && gap >= KEY_GAP_MIN;
  const rel = relativeKey(best.key, best.mode);

  return {
    key: best.key,
    mode: best.mode,
    label: `${best.key} ${best.mode}`,
    relative: rel,
    confidence: Math.round(confidence * 100) / 100,
    gap: Math.round(gap * 1000) / 1000,
    reliable,
    runnerUp: second ? `${second.key} ${second.mode}` : null,
    top: ranked.slice(0, 3).map((r) => ({
      label: `${r.key} ${r.mode}`,
      score: Math.round(r.score * 1000) / 1000,
    })),
  };
}

/**
 * Relative major/minor (same key signature).
 * C major ↔ A minor, G major ↔ E minor, etc.
 */
/**
 * Full pitch profile for a mono buffer.
 * Prefer multi-frame HPCP over a single averaged spectrum.
 */
export function estimatePitchProfile(mono, sampleRate, _magUnused = null) {
  const f0 = estimateF0(mono, sampleRate);
  const { chroma, frames } = accumulateChromagram(mono, sampleRate);
  const key = estimateKeyFromChroma(chroma);
  const relLabel = key.relative?.label || null;

  let note;
  if (key.reliable && f0.reliable) {
    note = `Key ${key.label} (rel. ${relLabel}) · lead ~${f0.f0Hz} Hz (${f0.register}). Mix-level estimate — verify on a stem if critical.`;
  } else if (key.reliable) {
    note = `Key ${key.label} · relative ${relLabel} (conf ${key.confidence}). F0 unclear on this mix — register from tone only.`;
  } else if (f0.reliable) {
    note = `Lead register ~${f0.f0Hz} Hz (${f0.register}). Key leaning ${key.label} vs ${
      key.runnerUp || "?"
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
    // Always surface best guess; keyReliable gates chain / Auto-Tune advice
    key: key.key,
    mode: key.mode,
    keyLabel: key.label,
    relativeKey: relLabel,
    keyConfidence: key.confidence,
    keyGap: key.gap,
    keyReliable: key.reliable,
    keyRunnerUp: key.runnerUp,
    keyCandidates: key.top,
    chromaFrames: frames,
    note,
  };
}
