/**
 * Characterize measurements, then build a full vocal chain.
 * Honesty rule: plausible reconstruction — never "this is what they used."
 */

import { buildVocalChain } from "./chain.js";
import {
  attachAffiliates,
  buildDesignBrief,
  buildMasterAnalysis,
  deepenTraits,
  deepSendExtras,
  deepVocalExtras,
} from "./pro/deep-analysis.js";

const TONE_THRESHOLDS = {
  air: { high: -8, low: -18 },
  sibilance: { high: -2, low: -10 },
  harshness: { high: -4, low: -12 },
  mud: { high: 0, low: -8 },
};

function levelFromTone(value, { high, low }) {
  if (value >= high) return "elevated";
  if (value <= low) return "recessed";
  return "balanced";
}

function crestCharacter(crestDb) {
  if (crestDb < 6) return "heavily_limited";
  if (crestDb < 9) return "controlled";
  if (crestDb < 14) return "dynamic";
  return "open";
}

function widthCharacter(sideMid, corr) {
  if (sideMid > 0.35 || corr < 0.4) return "wide";
  if (sideMid < 0.08 && corr > 0.85) return "narrow";
  return "focused";
}

/**
 * @param {object} readout — from measureBuffer
 */
export function characterize(readout) {
  const tone = {
    air: levelFromTone(readout.tone.air, TONE_THRESHOLDS.air),
    sibilance: levelFromTone(readout.tone.sibilance, TONE_THRESHOLDS.sibilance),
    harshness: levelFromTone(readout.tone.harshness, TONE_THRESHOLDS.harshness),
    mud: levelFromTone(readout.tone.mud, TONE_THRESHOLDS.mud),
  };

  const dynamics = crestCharacter(readout.dynamics.crestDb);
  const stereo = widthCharacter(readout.stereo.sideMidRatio, readout.stereo.correlation);

  const tempo = {
    bpm: readout.tempo?.bpm ?? null,
    confidence: readout.tempo?.confidence ?? 0,
    feel: readout.tempo?.feel ?? null,
  };
  const pitch = {
    f0Hz: readout.pitch?.f0Hz ?? null,
    keyLabel: readout.pitch?.keyLabel ?? null,
    register: readout.pitch?.register ?? "unknown",
    noteName: readout.pitch?.noteName ?? null,
  };

  const summary = [];
  if (tempo.bpm) {
    summary.push(
      `Pulse ≈ ${tempo.bpm} BPM${tempo.feel ? ` (${tempo.feel})` : ""}${
        tempo.confidence < 0.35 ? " · low confidence" : ""
      }.`
    );
  }
  if (pitch.keyLabel) {
    summary.push(
      `Tonal center ≈ ${pitch.keyLabel}${
        pitch.f0Hz ? ` · lead register ~${pitch.f0Hz.toFixed(0)} Hz (${pitch.register})` : ""
      }.`
    );
  } else if (pitch.f0Hz) {
    summary.push(`Lead register ~${pitch.f0Hz.toFixed(0)} Hz (${pitch.register}).`);
  }

  // Continuous-aware notes (not only elevated/recessed)
  const mud = readout.tone.mud;
  const sib = readout.tone.sibilance;
  const harsh = readout.tone.harshness;
  const air = readout.tone.air;
  const crest = readout.dynamics.crestDb;
  const targets = readout.eqTargets;

  if (tone.air === "elevated") summary.push("Air is up — top end is carrying presence.");
  else if (tone.air === "recessed") summary.push("Air is down — vocal sits darker / closer.");
  else if (air < -14) summary.push("Top end sits slightly dark — gentle air shelf likely.");

  if (tone.sibilance === "elevated") summary.push("Sibilance region is hot relative to body.");
  else if (sib > -5) summary.push(`Sibilance leaning forward (index ${sib.toFixed(1)}).`);

  if (tone.harshness === "elevated") summary.push("Upper-mid bite is forward (harshness band).");
  else if (harsh > -7) summary.push(`Upper-mid bite present — cut near ${targets?.harshHz || 3e3} Hz.`);

  if (tone.mud === "elevated") summary.push("Low-mids are heavy — body may be masking clarity.");
  else if (mud > -3) summary.push(`Low-mid weight — mud cut near ${targets?.mudHz || 320} Hz.`);

  if (dynamics === "heavily_limited") summary.push("Crest is low — dense, limited vocal region.");
  if (dynamics === "open") summary.push("Crest is high — more transient / less smashed.");
  if (dynamics === "controlled" || dynamics === "dynamic") {
    summary.push(`Crest ${crest.toFixed(1)} dB — compression dialed to this density.`);
  }

  if (stereo === "wide") summary.push("Stereo image is wide in the side channel.");
  if (stereo === "narrow") summary.push("Image is mono-leaning — centered vocal pocket.");

  if (targets) {
    summary.push(
      `EQ centers from this spectrum: mud ${targets.mudHz} · harsh ${targets.harshHz} · de-ess ${targets.deessHz} Hz.`
    );
  }

  if (!summary.length) summary.push("Balance sits near a typical contemporary vocal pocket.");

  return { tone, dynamics, stereo, tempo, pitch, summary };
}

/**
 * Full chain + short corrective highlights for the UI.
 * @param {'standard' | 'deep'} [mode]
 */
export function recommend(traits, pluginMap, daw = "universal", readout = null, mode = "standard") {
  if (!readout) {
    return {
      daw,
      mode,
      honesty: "Need a readout to dial the chain.",
      chain: null,
      steps: [],
    };
  }

  const deep = mode === "deep";
  const liveTraits = deep ? deepenTraits(readout, traits) : traits;
  let chain = buildVocalChain(readout, liveTraits, daw);

  if (deep) {
    const extras = deepVocalExtras(readout, liveTraits);
    const sendExtras = deepSendExtras(readout, liveTraits);
    // Insert deep stages after de-ess (before sat)
    const deessIdx = chain.inserts.findIndex((s) => s.role === "deess");
    if (deessIdx >= 0) {
      chain = {
        ...chain,
        inserts: [
          ...chain.inserts.slice(0, deessIdx + 1),
          ...extras,
          ...chain.inserts.slice(deessIdx + 1),
        ],
      };
    } else {
      chain = { ...chain, inserts: [...chain.inserts, ...extras] };
    }
    // Ambient / design sends before the final width note
    const widthIdx = chain.sends.findIndex((s) => s.role === "width");
    if (widthIdx >= 0) {
      chain = {
        ...chain,
        sends: [
          ...chain.sends.slice(0, widthIdx),
          ...sendExtras,
          ...chain.sends.slice(widthIdx),
        ],
      };
    } else {
      chain = { ...chain, sends: [...chain.sends, ...sendExtras] };
    }
    chain = attachAffiliates(chain);
    chain.honesty =
      "Deep Pro recreation — inserts, atmosphere, and sound-design lanes from the measured signature. Not a claim these were the exact plugins on the record.";
    chain.estimateNote =
      "Deep chain · match stages, then open Design for ambient / FX lanes and Master for the bus pass.";
  }

  const chars = pluginMap?.characteristics || {};
  const highlights = [];
  const maybe = (id, cond, why) => {
    if (!cond || !chars[id]) return;
    highlights.push({
      characteristic: id,
      why,
      teaching: chars[id].teaching || null,
      orderNote: chars[id].orderNote || null,
    });
  };
  maybe("mud", liveTraits.tone.mud === "elevated", "Mud elevated — trust the deeper low-mid cut in Step 2.");
  maybe("sibilance", liveTraits.tone.sibilance === "elevated", "Sibilance hot — don’t skip or under-do de-ess.");
  maybe("harshness", liveTraits.tone.harshness === "elevated", "Harshness forward — keep the measured upper-mid cut.");
  maybe(
    "dynamics_crest",
    liveTraits.dynamics === "heavily_limited" || liveTraits.dynamics === "controlled",
    "Low crest — serial compression in the chain is doing real work."
  );

  const master = deep ? buildMasterAnalysis(readout, liveTraits) : null;
  const design = deep ? buildDesignBrief(readout, liveTraits) : null;

  return {
    daw: "universal",
    mode,
    honesty: chain.honesty,
    estimateNote: chain.estimateNote,
    chain,
    master,
    design,
    traits: liveTraits,
    highlights,
    steps: chain.inserts.map((step) => ({
      characteristic: step.role,
      why: step.why,
      teaching: step.how,
      stock: {
        plugin: step.plugin,
        settings:
          step.settings ||
          (step.dials || []).map((d) => `${d.label}: ${d.value}`).join(" · "),
        gap: step.gap || null,
        notes: step.how,
      },
      free: step.free || null,
      paid: step.paid || null,
      affiliates: step.affiliates || null,
    })),
  };
}

export async function loadPluginMap(url) {
  const resolved = url || new URL("../data/plugin-map.json", import.meta.url).href;
  const res = await fetch(resolved);
  if (!res.ok) throw new Error(`Could not load plugin map (${res.status})`);
  return res.json();
}
