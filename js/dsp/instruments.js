/**
 * Heuristic instrument presence from a full-mix readout (no ML).
 * Returns labels + short mix tips — not per-instrument stems.
 */

function bandRel(bands, id) {
  const b = (bands || []).find((x) => x.id === id);
  return b?.dbRelTotal ?? -99;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * @param {object} readout — from measureBuffer (needs bandsFullMix / toneFull / stereo / dynamics)
 * @returns {{ id: string, label: string, confidence: number, tip: string }[]}
 */
export function detectInstruments(readout) {
  const bands = readout.bandsFullMix || readout.master?.bands || readout.bands || [];
  const tone = readout.toneFull || readout.tone || {};
  const stereo = readout.stereo || {};
  const crest = readout.dynamics?.crestDb ?? 10;
  const ti = readout.transientIndexFull ?? readout.transientIndex ?? 0;
  const centroid = readout.centroidFullHz || readout.centroidHz || 2500;
  const vocalCent = readout.centroidHz || centroid;
  const side = stereo.sideMidRatio ?? 0;
  const corr = stereo.correlation ?? 1;

  const sub = bandRel(bands, "sub");
  const bass = bandRel(bands, "bass");
  const lowMid = bandRel(bands, "low_mid");
  const mid = bandRel(bands, "mid");
  const presence = bandRel(bands, "presence");
  const brilliance = bandRel(bands, "brilliance");
  const air = bandRel(bands, "air");

  /** @type {{ id: string, label: string, confidence: number, tip: string }[]} */
  const out = [];

  const kickConf = clamp01((sub + 14) / 18 + (crest < 10 ? 0.15 : 0) + (ti > 2 ? 0.1 : 0));
  if (kickConf > 0.28) {
    out.push({
      id: "kick",
      label: "Kick / sub punch",
      confidence: kickConf,
      tip: "Keep kick mono below ~100 Hz. Carve bass 40–80 Hz opposite the kick fundamental so they don’t fight.",
    });
  }

  const bassConf = clamp01((bass + 12) / 16 + (bass > sub + 1 ? 0.2 : 0) - (kickConf > 0.7 ? 0.08 : 0));
  if (bassConf > 0.3) {
    out.push({
      id: "bass",
      label: "Bass",
      confidence: bassConf,
      tip: "Side-chain or dynamic EQ vs kick. High-pass non-bass buses ~80–120 Hz so the bed stays clean.",
    });
  }

  const hatsConf = clamp01((brilliance + 10) / 14 + (air + 14) / 18 + (ti > 4 ? 0.25 : 0) + (tone.harshness > -6 ? 0.1 : 0));
  if (hatsConf > 0.32) {
    out.push({
      id: "hats",
      label: "Hats / cymbals",
      confidence: hatsConf,
      tip: "Surgical cut 4–8 kHz if hats mask vocals. Prefer shelf control over de-ess on the instrumental bus.",
    });
  }

  const padsConf = clamp01(
    (mid + 10) / 14 + (lowMid + 10) / 16 + (ti < 1 ? 0.25 : 0) + (side > 0.18 ? 0.15 : 0) - (ti > 6 ? 0.2 : 0)
  );
  if (padsConf > 0.34) {
    out.push({
      id: "pads",
      label: "Pads / synth bed",
      confidence: padsConf,
      tip: "Cut 200–400 Hz on pads when vocals arrive. Keep width on the bed, not the lead.",
    });
  }

  const guitarConf = clamp01(
    (presence + 9) / 13 + (mid + 8) / 12 + (centroid > 1800 && centroid < 4500 ? 0.2 : 0) - (hatsConf > 0.7 ? 0.1 : 0)
  );
  if (guitarConf > 0.36) {
    out.push({
      id: "guitar",
      label: "Guitar / mid lead",
      confidence: guitarConf,
      tip: "Carve 2–4 kHz if a vocal will sit on top. Check mono — mid guitars often need a gentle center dip.",
    });
  }

  const vocalGap = Math.abs(vocalCent - centroid);
  const vocalConf = clamp01(
    (presence + 8) / 12 +
      (readout.target === "vocal" ? 0.15 : 0) +
      (vocalGap > 200 ? 0.12 : 0) +
      (corr > 0.55 ? 0.08 : 0) +
      (tone.sibilance > -8 ? 0.12 : 0)
  );
  if (vocalConf > 0.38 || readout.target === "vocal") {
    out.push({
      id: "vocals",
      label: "Vocals",
      confidence: Math.max(vocalConf, readout.target === "vocal" ? 0.55 : vocalConf),
      tip: "Leave a pocket 2–5 kHz in the instrumental. De-ess and air live on the vocal chain, not the bed.",
    });
  }

  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 6);
}
