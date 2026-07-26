/**
 * Match my mix — diff two readouts (user's mix vs reference) and turn the
 * gap into a small set of prioritized, concrete moves.
 */

/**
 * @typedef {Object} MatchMove
 * @property {string} title    Short imperative headline ("Cut ~3 dB around 300 Hz")
 * @property {string} detail   Why — what was measured
 * @property {number} weight   Internal ranking weight
 */

/**
 * @typedef {Object} MatchReport
 * @property {Array<{ key: string, value: string, sub: string, sign: -1|0|1 }>} metrics
 * @property {Array<{ id: string, label: string, lo: number, hi: number, deltaDb: number }>} bands
 * @property {MatchMove[]} moves
 * @property {string} verdict
 * @property {string} note
 */

const MEANINGFUL_BAND_DB = 1.5;

/**
 * @param {object} ref   Reference readout (the sound you want)
 * @param {object} mine  User's mix readout
 * @param {{ target?: string }} [opts]
 * @returns {MatchReport}
 */
export function compareMixes(ref, mine, opts = {}) {
  const target = opts.target || ref?.target || "vocal";
  const subject =
    target === "instrumental" ? "your instrumental" : target === "full" ? "your mix" : "your vocal";

  const bands = diffBands(ref, mine);
  const moves = [];
  const metrics = [];

  // ---- Frequency balance ----------------------------------------------
  const eqTargets = ref?.eqTargets || {};
  for (const band of bands) {
    const mag = Math.abs(band.deltaDb);
    if (mag < MEANINGFUL_BAND_DB) continue;
    const heavier = band.deltaDb > 0;
    const centerHz = bandCenterHz(band, eqTargets);
    moves.push({
      title: `${heavier ? "Cut" : "Boost"} ~${fmtDb(Math.min(mag, 6))} around ${fmtHz(centerHz)}`,
      detail: `${cap(subject)} carries ${fmtDb(mag)} ${heavier ? "more" : "less"} ${band.label.toLowerCase()} energy (${band.lo}–${band.hi} Hz) than the reference.`,
      weight: mag * (band.id === "mid" || band.id === "presence" ? 1.2 : 1),
    });
  }

  // ---- Overall brightness ---------------------------------------------
  const refCentroid = num(ref?.centroidHz);
  const myCentroid = num(mine?.centroidHz);
  if (refCentroid && myCentroid) {
    const ratio = myCentroid / refCentroid;
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    const darker = ratio < 1;
    metrics.push({
      key: "Brightness",
      value: pct < 5 ? "Matched" : `${pct}% ${darker ? "darker" : "brighter"}`,
      sub: `centroid ${Math.round(myCentroid)} vs ${Math.round(refCentroid)} Hz`,
      sign: pct < 5 ? 0 : darker ? -1 : 1,
    });
    if (pct >= 10) {
      const shelfHz = num(eqTargets.airHz) || 10000;
      moves.push({
        title: darker
          ? `Add a high shelf (+1–2 dB) near ${fmtHz(shelfHz)}`
          : `Pull the top down (−1–2 dB shelf) near ${fmtHz(shelfHz)}`,
        detail: `${cap(subject)} reads ${pct}% ${darker ? "darker" : "brighter"} overall than the reference (spectral centroid).`,
        weight: pct * 0.18,
      });
    }
  }

  // ---- Sibilance / harshness ------------------------------------------
  const sibDelta = toneDelta(ref, mine, "sibilance");
  if (sibDelta != null && Math.abs(sibDelta) >= 2 && target !== "instrumental") {
    const hotter = sibDelta > 0;
    const deessHz = num(eqTargets.deessHz) || 7000;
    moves.push({
      title: hotter
        ? `De-ess harder around ${fmtHz(deessHz)}`
        : `Ease the de-esser — you're ${fmtDb(Math.abs(sibDelta))} duller up top`,
      detail: `Sibilance energy is ${fmtDb(Math.abs(sibDelta))} ${hotter ? "hotter" : "softer"} than the reference.`,
      weight: Math.abs(sibDelta) * 0.9,
    });
  }

  // ---- Dynamics ---------------------------------------------------------
  const refCrest = num(ref?.dynamics?.crestDb);
  const myCrest = num(mine?.dynamics?.crestDb);
  if (refCrest != null && myCrest != null) {
    const delta = myCrest - refCrest; // positive: mine is more dynamic / less compressed
    const mag = Math.abs(delta);
    const pctLess = Math.round((mag / Math.max(refCrest, 1)) * 100);
    metrics.push({
      key: "Dynamics",
      value:
        mag < 1.5
          ? "Matched"
          : delta > 0
            ? `${pctLess}% less controlled`
            : `${pctLess}% more squashed`,
      sub: `crest ${myCrest.toFixed(1)} vs ${refCrest.toFixed(1)} dB`,
      sign: mag < 1.5 ? 0 : delta > 0 ? 1 : -1,
    });
    if (mag >= 2.5) {
      moves.push({
        title:
          delta > 0
            ? `Compress ${fmtDb(Math.min(mag * 0.7, 6))} more`
            : `Back the compression off ~${fmtDb(Math.min(mag * 0.7, 6))}`,
        detail:
          delta > 0
            ? `${cap(subject)} is ${fmtDb(mag)} more dynamic than the reference — peaks are getting away from the level.`
            : `${cap(subject)} is ${fmtDb(mag)} flatter than the reference — let a little more transient through.`,
        weight: mag * 1.1,
      });
    }
  }

  // ---- Stereo width ------------------------------------------------------
  const refWidth = num(ref?.stereo?.sideMidRatio);
  const myWidth = num(mine?.stereo?.sideMidRatio);
  if (refWidth != null && myWidth != null) {
    const delta = myWidth - refWidth;
    const mag = Math.abs(delta);
    metrics.push({
      key: "Width",
      value: mag < 0.08 ? "Matched" : delta > 0 ? "Wider" : "Narrower",
      sub: `side/mid ${myWidth.toFixed(2)} vs ${refWidth.toFixed(2)}`,
      sign: mag < 0.08 ? 0 : delta > 0 ? 1 : -1,
    });
    if (mag >= 0.14) {
      moves.push({
        title: delta > 0 ? "Rein the width in" : "Open the stereo field up",
        detail: `Side/mid ratio is ${myWidth.toFixed(2)} vs the reference's ${refWidth.toFixed(2)} — ${
          delta > 0
            ? "your image is noticeably wider, which can cost mono punch."
            : "the reference uses more side energy (doubles, wide sends, stereo FX)."
        }`,
        weight: mag * 14,
      });
    }
  }

  // ---- Loudness (context, weighted low) ----------------------------------
  const refLoud = num(ref?.loudness?.lufsProxy);
  const myLoud = num(mine?.loudness?.lufsProxy);
  if (refLoud != null && myLoud != null) {
    const delta = myLoud - refLoud;
    const mag = Math.abs(delta);
    metrics.push({
      key: "Loudness",
      value: mag < 1.5 ? "Matched" : `${fmtDb(mag)} ${delta > 0 ? "louder" : "quieter"}`,
      sub: `≈${myLoud.toFixed(1)} vs ${refLoud.toFixed(1)} LUFS proxy`,
      sign: mag < 1.5 ? 0 : delta > 0 ? 1 : -1,
    });
    if (mag >= 3) {
      moves.push({
        title: delta > 0 ? "You're overshooting the loudness" : "There's loudness left on the table",
        detail: `Judge the tone moves first — level differences this big (${fmtDb(mag)}) skew every A/B. Match playback loudness, then re-compare.`,
        weight: 0.5,
      });
    }
  }

  // ---- Mud / harshness quick metrics --------------------------------------
  const mudDelta = toneDelta(ref, mine, "mud");
  if (mudDelta != null) {
    metrics.push({
      key: "Mud (200–500)",
      value: Math.abs(mudDelta) < 1.5 ? "Matched" : `${fmtDb(Math.abs(mudDelta))} ${mudDelta > 0 ? "heavier" : "leaner"}`,
      sub: "low-mid buildup",
      sign: Math.abs(mudDelta) < 1.5 ? 0 : mudDelta > 0 ? 1 : -1,
    });
  }
  const harshDelta = toneDelta(ref, mine, "harshness");
  if (harshDelta != null) {
    metrics.push({
      key: "Harshness",
      value: Math.abs(harshDelta) < 1.5 ? "Matched" : `${fmtDb(Math.abs(harshDelta))} ${harshDelta > 0 ? "hotter" : "smoother"}`,
      sub: "2–5 kHz bite",
      sign: Math.abs(harshDelta) < 1.5 ? 0 : harshDelta > 0 ? 1 : -1,
    });
  }

  moves.sort((a, b) => b.weight - a.weight);
  const topMoves = moves.slice(0, 5);

  const verdict = buildVerdict(topMoves, subject);
  const note =
    mine?.estimate && target !== "full"
      ? `Heads up: ${subject} was estimated from your full mix — upload the matching stem for a tighter diff.`
      : "";

  return { metrics, bands, moves: topMoves, verdict, note };
}

function buildVerdict(moves, subject) {
  if (!moves.length) {
    return `Honestly? ${cap(subject)} already sits very close to the reference. Trust it.`;
  }
  const n = Math.min(moves.length, 3);
  return `${n === 1 ? "One move" : `${n} moves`} will close most of the gap between ${subject} and the reference.`;
}

function diffBands(ref, mine) {
  const refBands = Array.isArray(ref?.bands) ? ref.bands : [];
  const mineBands = Array.isArray(mine?.bands) ? mine.bands : [];
  const byId = new Map(mineBands.map((b) => [b.id, b]));
  const out = [];
  for (const rb of refBands) {
    const mb = byId.get(rb.id);
    if (!mb) continue;
    const deltaDb = num(mb.dbRelTotal) != null && num(rb.dbRelTotal) != null
      ? mb.dbRelTotal - rb.dbRelTotal
      : 0;
    out.push({ id: rb.id, label: rb.label, lo: rb.lo, hi: rb.hi, deltaDb });
  }
  return out;
}

function bandCenterHz(band, eqTargets) {
  if (band.id === "low_mid" && num(eqTargets.mudHz)) return eqTargets.mudHz;
  if (band.id === "mid" && num(eqTargets.harshHz)) return eqTargets.harshHz;
  if (band.id === "presence" && num(eqTargets.presenceHz)) return eqTargets.presenceHz;
  if ((band.id === "air" || band.id === "brilliance") && num(eqTargets.airHz)) return eqTargets.airHz;
  return Math.round(Math.sqrt(band.lo * Math.min(band.hi, 20000)));
}

function toneDelta(ref, mine, key) {
  const r = num(ref?.tone?.[key]);
  const m = num(mine?.tone?.[key]);
  if (r == null || m == null) return null;
  return m - r;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtDb(v) {
  const n = Math.abs(v);
  return `${n >= 10 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, "")} dB`;
}

function fmtHz(hz) {
  if (!hz) return "—";
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${Math.round(hz)} Hz`;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
