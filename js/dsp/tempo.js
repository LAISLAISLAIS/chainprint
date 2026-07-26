/**
 * Tempo estimation — spectral-flux onset strength + tempo autocorrelation
 * with Ellis-style log-Gaussian preference and harmonic (comb) reinforcement.
 *
 * Designed for finished mixes / previews. Confidence drops on sparse,
 * rubato, or heavily swung material. Not a DAW beat grid.
 *
 * Refs: Ellis (2007) beat tracking; librosa.beat.tempo; spectral-flux ODFs.
 */

const BPM_MIN = 60;
const BPM_MAX = 200;
const PREFERRED_BPM = 120;
const MAX_ANALYZE_SEC = 60;
const FFT = 1024;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/** Minimal real FFT magnitude via DFT for small FFT sizes (radix-2). */
function magSpectrum(frame, window) {
  const n = frame.length;
  const half = (n >> 1) + 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * window[i];

  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
        const vIm = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextWr = wr * wlenRe - wi * wlenIm;
        wi = wr * wlenIm + wi * wlenRe;
        wr = nextWr;
      }
    }
  }

  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/**
 * Multi-band spectral flux onset detection function.
 * Emphasizes low-mid (kick/snare body) + mid (hats/vocal consonants).
 */
function spectralFluxOdf(mono, sampleRate) {
  const hop = Math.max(256, Math.round(sampleRate * 0.01)); // 10 ms
  const win = hann(FFT);
  const start = Math.min(mono.length, Math.round(sampleRate * 0.25));
  const end = Math.min(mono.length, start + Math.round(sampleRate * MAX_ANALYZE_SEC));
  const nFrames = Math.max(1, Math.floor((end - start - FFT) / hop) + 1);

  const binHz = sampleRate / FFT;
  const iLo = Math.max(1, Math.floor(40 / binHz));
  const iKick = Math.min(FFT / 2, Math.ceil(200 / binHz));
  const iMid = Math.min(FFT / 2, Math.ceil(2000 / binHz));
  const iHi = Math.min(FFT / 2, Math.ceil(8000 / binHz));

  const odf = new Float64Array(nFrames);
  let prev = null;

  for (let f = 0; f < nFrames; f++) {
    const off = start + f * hop;
    const frame = new Float32Array(FFT);
    const avail = Math.min(FFT, end - off);
    if (avail > 0) frame.set(mono.subarray(off, off + avail));
    const mag = magSpectrum(frame, win);

    let flux = 0;
    if (prev) {
      for (let i = iLo; i <= iKick; i++) {
        const d = mag[i] - prev[i];
        if (d > 0) flux += d * 1.6; // kick / low pulse
      }
      for (let i = iKick + 1; i <= iMid; i++) {
        const d = mag[i] - prev[i];
        if (d > 0) flux += d * 1.1;
      }
      for (let i = iMid + 1; i <= iHi; i++) {
        const d = mag[i] - prev[i];
        if (d > 0) flux += d * 0.55;
      }
    }
    odf[f] = flux;
    prev = mag;
  }

  // Subtract local mean (high-pass the ODF) then half-wave
  const smooth = 8;
  const hp = new Float64Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let s = 0;
    let c = 0;
    for (let k = -smooth; k <= smooth; k++) {
      const j = i + k;
      if (j >= 0 && j < nFrames) {
        s += odf[j];
        c += 1;
      }
    }
    hp[i] = Math.max(0, odf[i] - s / c);
  }

  // Light normalize
  let peak = 0;
  for (let i = 0; i < nFrames; i++) if (hp[i] > peak) peak = hp[i];
  if (peak > 0) for (let i = 0; i < nFrames; i++) hp[i] /= peak;

  return { odf: hp, hopSec: hop / sampleRate, frames: nFrames };
}

/** Ellis log-Gaussian tempo prior centered on 120 BPM. */
function tempoPrior(bpm) {
  const x = Math.log2(bpm / PREFERRED_BPM);
  return Math.exp(-0.5 * (x * x) / (0.55 * 0.55));
}

function autocorr(odf) {
  const n = odf.length;
  const ac = new Float64Array(n);
  for (let lag = 0; lag < n; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += odf[i] * odf[i + lag];
    ac[lag] = s;
  }
  // Normalize by lag-0
  if (ac[0] > 0) for (let i = 0; i < n; i++) ac[i] /= ac[0];
  return ac;
}

/**
 * Comb-filter style score: reinforce harmonics / subharmonics of a candidate lag.
 */
function combScore(ac, lag) {
  if (lag <= 0 || lag >= ac.length) return 0;
  let s = ac[lag];
  if (lag * 2 < ac.length) s += 0.5 * ac[lag * 2];
  if (lag * 3 < ac.length) s += 0.33 * ac[lag * 3];
  if (lag * 4 < ac.length) s += 0.25 * ac[lag * 4];
  const half = Math.round(lag / 2);
  if (half >= 1 && half < ac.length) s += 0.5 * ac[half];
  const third = Math.round(lag / 3);
  if (third >= 1 && third < ac.length) s += 0.25 * ac[third];
  return s;
}

function parabolicRefine(y0, y1, y2) {
  const denom = 2 * (2 * y1 - y0 - y2);
  if (Math.abs(denom) < 1e-12) return 0;
  return (y0 - y2) / denom;
}

function estimateBpmFromOdf(odf, hopSec) {
  const ac = autocorr(odf);
  const lagMin = Math.max(2, Math.floor(60 / (BPM_MAX * hopSec)));
  const lagMax = Math.min(ac.length - 2, Math.ceil(60 / (BPM_MIN * hopSec)));
  if (lagMax <= lagMin + 2) return { bpm: null, confidence: 0, candidates: [] };

  const scored = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 / (lag * hopSec);
    if (bpm < BPM_MIN || bpm > BPM_MAX) continue;
    const raw = combScore(ac, lag);
    const score = raw * tempoPrior(bpm);
    scored.push({ lag, bpm, raw, score });
  }
  scored.sort((a, b) => b.score - a.score);

  if (!scored.length) return { bpm: null, confidence: 0, candidates: [] };

  // Parabolic refine best lag
  let best = scored[0];
  const lag = best.lag;
  if (lag > 0 && lag + 1 < ac.length) {
    const delta = parabolicRefine(ac[lag - 1], ac[lag], ac[lag + 1]);
    const refinedLag = lag + delta;
    best = {
      ...best,
      bpm: 60 / (refinedLag * hopSec),
      lag: refinedLag,
    };
  }

  // Octave / metrical level: among top candidates near half/double, pick by prior×comb
  const target = best.bpm;
  const relatives = scored.filter((c) => {
    const r = c.bpm / target;
    return (
      Math.abs(r - 1) < 0.06 ||
      Math.abs(r - 2) < 0.08 ||
      Math.abs(r - 0.5) < 0.08 ||
      Math.abs(r - 1.5) < 0.08 ||
      Math.abs(r - 2 / 3) < 0.08
    );
  });
  relatives.sort((a, b) => b.score - a.score);
  const chosen = relatives[0] || best;

  // Confidence: peak prominence vs next unrelated candidate
  const top = chosen.score;
  const rival = scored.find(
    (c) => Math.abs(Math.log2(c.bpm / chosen.bpm)) > 0.15 && c.lag !== chosen.lag
  );
  const rivalScore = rival?.score ?? top * 0.5;
  const prominence = top > 0 ? (top - rivalScore) / top : 0;
  const confidence = clamp(0.25 + chosen.raw * 0.45 + prominence * 0.45, 0, 1);

  return {
    bpm: Math.round(chosen.bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    candidates: scored.slice(0, 5).map((c) => ({
      bpm: Math.round(c.bpm * 10) / 10,
      score: Math.round(c.score * 1000) / 1000,
    })),
  };
}

/**
 * @param {Float32Array} mono
 * @param {number} sampleRate
 */
export function estimateTempo(mono, sampleRate) {
  if (!mono?.length || !sampleRate) {
    return { bpm: null, confidence: 0, reliable: false, note: "No audio for tempo." };
  }
  if (mono.length < sampleRate * 3) {
    return {
      bpm: null,
      confidence: 0,
      reliable: false,
      note: "Clip too short for a reliable BPM read — upload ≥3s (ideally 15–60s).",
    };
  }

  const { odf, hopSec } = spectralFluxOdf(mono, sampleRate);
  const energy = odf.reduce((a, v) => a + v, 0) / Math.max(1, odf.length);
  if (energy < 1e-5) {
    return {
      bpm: null,
      confidence: 0,
      reliable: false,
      note: "Couldn’t find a clear pulse (very quiet or ambient).",
    };
  }

  const { bpm, confidence, candidates } = estimateBpmFromOdf(odf, hopSec);
  if (!bpm) {
    return {
      bpm: null,
      confidence: 0,
      reliable: false,
      note: "Couldn’t lock a steady pulse — set delay by ear in your DAW.",
    };
  }

  const reliable = confidence >= 0.42;
  const feel =
    bpm < 85 ? "ballad" : bpm < 110 ? "mid" : bpm < 140 ? "uptempo" : "fast";

  return {
    bpm,
    confidence,
    reliable,
    feel,
    candidates,
    note: reliable
      ? `BPM from spectral-flux tempo estimate (~${bpm}).`
      : `Low-confidence BPM (~${bpm}) — verify on the grid before tempo-syncing FX.`,
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
