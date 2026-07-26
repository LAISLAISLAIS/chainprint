/**
 * Tempo estimate from onset-strength autocorrelation.
 * Works on finished mixes / previews — confidence will be lower on sparse or
 * heavily swung material. Not a DAW-grade beat grid.
 */

const BPM_MIN = 70;
const BPM_MAX = 180;
const MAX_ANALYZE_SEC = 45;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Spectral-flux-ish onset envelope via short energy frames.
 * @returns {{ envelope: Float64Array, hopSec: number }}
 */
function onsetEnvelope(mono, sampleRate) {
  const hop = Math.max(256, Math.round(sampleRate * 0.0116)); // ~11.6 ms
  const win = hop * 2;
  const start = Math.min(mono.length, Math.round(sampleRate * 0.4));
  const end = Math.min(mono.length, start + Math.round(sampleRate * MAX_ANALYZE_SEC));
  const nFrames = Math.max(1, Math.floor((end - start - win) / hop) + 1);
  const env = new Float64Array(nFrames);

  let prev = 0;
  for (let f = 0; f < nFrames; f++) {
    const off = start + f * hop;
    let e = 0;
    for (let i = 0; i < win && off + i < end; i++) {
      const x = mono[off + i];
      e += x * x;
    }
    const flux = Math.max(0, e - prev);
    env[f] = flux;
    prev = e;
  }

  // High-pass the envelope (remove slow loudness drift)
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= Math.max(1, env.length);
  for (let i = 0; i < env.length; i++) env[i] = Math.max(0, env[i] - mean * 0.5);

  return { envelope: env, hopSec: hop / sampleRate };
}

function autocorrPeak(envelope, hopSec) {
  const lagMin = Math.max(1, Math.floor(60 / (BPM_MAX * hopSec)));
  const lagMax = Math.min(envelope.length - 1, Math.ceil(60 / (BPM_MIN * hopSec)));
  if (lagMax <= lagMin + 2) {
    return { bpm: null, confidence: 0, lag: 0 };
  }

  let bestLag = lagMin;
  let bestScore = -Infinity;
  const scores = new Float64Array(lagMax + 1);

  for (let lag = lagMin; lag <= lagMax; lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    const n = envelope.length - lag;
    for (let i = 0; i < n; i++) {
      const a = envelope[i];
      const b = envelope[i + lag];
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const score = num / (Math.sqrt(denA * denB) + 1e-12);
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Prefer lags whose BPM sits in a common pocket when scores are close
  let chosen = bestLag;
  let chosenScore = bestScore;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 / (lag * hopSec);
    const pocket = bpm >= 85 && bpm <= 140 ? 1.04 : 1;
    const s = scores[lag] * pocket;
    if (s > chosenScore) {
      chosenScore = s;
      chosen = lag;
    }
  }

  let bpm = 60 / (chosen * hopSec);

  // Resolve octave errors into a musical range, preferring a common pocket
  const candidates = [bpm, bpm * 2, bpm / 2, bpm * 3 / 2, bpm * 2 / 3]
    .filter((b) => b >= BPM_MIN && b <= BPM_MAX)
    .map((b) => {
      const lag = Math.round(60 / (b * hopSec));
      const raw = lag >= lagMin && lag <= lagMax ? scores[lag] : bestScore * 0.85;
      const pocket = b >= 88 && b <= 135 ? 1.08 : b >= 70 && b <= 160 ? 1.02 : 1;
      return { bpm: b, score: raw * pocket };
    })
    .sort((a, b) => b.score - a.score);

  if (candidates.length) bpm = candidates[0].bpm;

  while (bpm < BPM_MIN && bpm * 2 <= BPM_MAX) bpm *= 2;
  while (bpm > BPM_MAX && bpm / 2 >= BPM_MIN) bpm /= 2;

  // Soften confidence for short / flat envelopes
  const energy =
    envelope.reduce((a, v) => a + v, 0) / Math.max(1, envelope.length);
  const confidence = clamp(bestScore * (energy > 1e-8 ? 1 : 0.4), 0, 1);

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    lag: chosen,
  };
}

/**
 * @param {Float32Array} mono
 * @param {number} sampleRate
 */
export function estimateTempo(mono, sampleRate) {
  if (!mono?.length || !sampleRate) {
    return { bpm: null, confidence: 0, note: "No audio for tempo." };
  }
  if (mono.length < sampleRate * 2) {
    return {
      bpm: null,
      confidence: 0,
      note: "Clip too short for a reliable BPM read — upload a longer section.",
    };
  }

  const { envelope, hopSec } = onsetEnvelope(mono, sampleRate);
  const { bpm, confidence } = autocorrPeak(envelope, hopSec);

  if (!bpm || confidence < 0.15) {
    return {
      bpm: null,
      confidence,
      note: "Couldn’t lock a steady pulse — set delay by ear or enter BPM in your DAW.",
    };
  }

  const feel =
    bpm < 85 ? "ballad" : bpm < 110 ? "mid" : bpm < 140 ? "uptempo" : "fast";

  return {
    bpm,
    confidence,
    feel,
    note:
      confidence < 0.35
        ? "Low-confidence BPM — verify against the grid before tempo-syncing FX."
        : "Estimated from mix pulse (onset autocorrelation).",
  };
}

/** Delay time helpers from BPM. */
export function noteMs(bpm, fraction = 0.5) {
  if (!bpm || bpm <= 0) return null;
  return Math.round((60000 / bpm) * fraction);
}

export function pickDelayNote(bpm, feel) {
  if (!bpm) {
    return { label: "1/8 or dotted 1/8", ms: null, fraction: 0.5 };
  }
  // Ballads: longer throws; fast tracks: tighter 1/8 or 1/16
  if (feel === "ballad" || bpm < 90) {
    return { label: "dotted 1/8", ms: noteMs(bpm, 0.75), fraction: 0.75 };
  }
  if (feel === "fast" || bpm >= 145) {
    return { label: "1/16", ms: noteMs(bpm, 0.25), fraction: 0.25 };
  }
  if (bpm >= 120) {
    return { label: "1/8", ms: noteMs(bpm, 0.5), fraction: 0.5 };
  }
  return { label: "dotted 1/8", ms: noteMs(bpm, 0.75), fraction: 0.75 };
}
