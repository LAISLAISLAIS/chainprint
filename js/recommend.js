/**
 * Characterize measurements, then build a chain for the selected target.
 * Honesty rule: plausible reconstruction — never "this is what they used."
 */

import { buildVocalChain } from "./chain.js";
import { buildFullMixChain, buildInstrumentalChain } from "./mix-chains.js";
import { normalizeTarget } from "./dsp/metrics.js";
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
  const target = normalizeTarget(readout.target);

  const tempo = {
    bpm: readout.tempo?.bpm ?? null,
    confidence: readout.tempo?.confidence ?? 0,
    feel: readout.tempo?.feel ?? null,
    reliable: Boolean(readout.tempo?.reliable),
  };
  const pitch = {
    f0Hz: readout.pitch?.f0Hz ?? null,
    keyLabel: readout.pitch?.keyLabel ?? null,
    register: readout.pitch?.register ?? "unknown",
    noteName: readout.pitch?.noteName ?? null,
    keyReliable: Boolean(readout.pitch?.keyReliable),
    f0Reliable: Boolean(readout.pitch?.f0Reliable),
    keyConfidence: readout.pitch?.keyConfidence ?? 0,
  };

  const findings = [];
  const pushFinding = (label, text) => {
    findings.push({ label, text });
  };

  if (target === "instrumental") {
    pushFinding("Target", "This chain is for an instrumental bed — low-end carve, bus glue, and stereo width.");
  } else if (target === "full") {
    pushFinding("Target", "This chain is for a full mix — bus EQ, glue, imaging, then delivery checks.");
  } else {
    pushFinding("Target", "This chain is for the vocal — built from the vocal region of the reference.");
  }
  if (readout.sourceKind === "stem") {
    pushFinding("Source", "You uploaded a stem — this read is more accurate than estimating from a full master.");
  }

  if (tempo.bpm && tempo.reliable) {
    pushFinding("Tempo", `About ${tempo.bpm} BPM. Use this to time delays and throws.`);
  } else if (tempo.bpm) {
    pushFinding("Tempo", `Maybe ~${tempo.bpm} BPM (uncertain). Check it before syncing FX to tempo.`);
  }
  if (pitch.keyLabel && pitch.keyReliable) {
    pushFinding(
      "Key",
      `${pitch.keyLabel}${
        readout.pitch?.relativeKey ? ` (relative ${readout.pitch.relativeKey})` : ""
      }${
        pitch.f0Hz && pitch.f0Reliable
          ? `. Lead sits near ${pitch.f0Hz.toFixed(0)} Hz (${pitch.register}).`
          : "."
      }`
    );
  } else if (pitch.keyLabel) {
    pushFinding(
      "Key",
      `Leaning ${pitch.keyLabel}${
        readout.pitch?.relativeKey ? ` / ${readout.pitch.relativeKey}` : ""
      }. Confirm by ear before locking your scale.`
    );
  } else if (pitch.f0Hz && pitch.f0Reliable) {
    pushFinding(
      "Pitch",
      `Lead around ${pitch.f0Hz.toFixed(0)} Hz (${pitch.register}). Key wasn’t clear enough to lock.`
    );
  } else if (readout.pitch?.keyRunnerUp) {
    pushFinding(
      "Key",
      `Ambiguous (${readout.pitch.keyCandidates?.[0]?.label || "?"} vs ${readout.pitch.keyRunnerUp}). Set the scale yourself.`
    );
  }

  const mud = readout.tone.mud;
  const sib = readout.tone.sibilance;
  const harsh = readout.tone.harshness;
  const air = readout.tone.air;
  const crest = readout.dynamics.crestDb;
  const targets = readout.eqTargets;

  if (target === "vocal") {
    if (tone.air === "elevated") {
      pushFinding("Air", "Bright top end — a gentle high shelf will match the reference.");
    } else if (tone.air === "recessed") {
      pushFinding("Air", "Darker top — don’t over-brighten; keep the vocal closer and softer up high.");
    } else if (air < -14) {
      pushFinding("Air", "Slightly dark overall — a small air shelf is enough.");
    }

    if (tone.sibilance === "elevated") {
      pushFinding("Sibilance", "S and T sounds are hot. De-ess after compression.");
    } else if (sib > -5) {
      pushFinding("Sibilance", "Sibilance is a bit forward. Watch the de-esser.");
    }

    if (tone.harshness === "elevated") {
      pushFinding(
        "Harshness",
        `Upper-mid bite is forward. Cut near ${targets?.harshHz || 3000} Hz in Subtractive EQ.`
      );
    } else if (harsh > -7) {
      pushFinding(
        "Harshness",
        `Some upper-mid bite — a cut near ${targets?.harshHz || 3000} Hz helps.`
      );
    }

    if (tone.mud === "elevated") {
      pushFinding(
        "Low-mids",
        `Muddy around ${targets?.mudHz || 320} Hz. Cut this in Subtractive EQ before you compress.`
      );
    } else if (mud > -3) {
      pushFinding(
        "Low-mids",
        `Some low-mid weight — a cut near ${targets?.mudHz || 320} Hz keeps the vocal clear.`
      );
    }
  } else {
    const fullTone = readout.toneFull || readout.tone;
    if (fullTone.mud > -2) {
      pushFinding("Low end", "Low-mids are heavy. Carve kick/bass and high-pass non-bass groups.");
    }
    if (fullTone.harshness > -6) {
      pushFinding("Top end", "Hats/cymbals are hot. Tame them before adding air.");
    }
    if (readout.stereo.sideMidRatio > 0.25) {
      pushFinding("Width", "Lots of side energy. Keep lows mono; widen by band, not with one widener.");
    }
  }

  if (dynamics === "heavily_limited") {
    pushFinding("Dynamics", "Very dense (low crest). Use two light compressors, not one slammed limiter.");
  }
  if (dynamics === "open") {
    pushFinding("Dynamics", "Open and dynamic. Don’t over-compress — keep the transient life.");
  }
  if (dynamics === "controlled" || dynamics === "dynamic") {
    pushFinding(
      "Dynamics",
      `Crest about ${crest.toFixed(1)} dB. Compression in the chain is set for this density.`
    );
  }

  if (stereo === "wide") {
    pushFinding("Stereo", "Wide image. Keep the lead centered; put width on doubles and FX.");
  }
  if (stereo === "narrow") {
    pushFinding("Stereo", "Narrow / centered image. Don’t force width on the lead.");
  }

  if (targets && target === "vocal") {
    // EQ centers stay in the technical console — too cryptic for the Why page.
  }

  const instruments = readout.instruments || [];
  if (instruments.length && target !== "vocal") {
    const top = instruments
      .slice(0, 3)
      .map((i) => i.label)
      .join(", ");
    pushFinding("Sources", `Likely hearing: ${top}.`);
  }

  if (!findings.length) {
    pushFinding("Balance", "Sits near a typical contemporary mix pocket.");
  }

  const summary = findings.map((f) => f.text);

  return { tone, dynamics, stereo, tempo, pitch, summary, findings, target, instruments };
}

function buildChainForTarget(target, readout, traits, daw) {
  if (target === "instrumental") return buildInstrumentalChain(readout, traits, daw);
  if (target === "full") return buildFullMixChain(readout, traits, daw);
  return buildVocalChain(readout, traits, daw);
}

/** Resolve a chain insert by role so copy names the real stage, not a hardcoded Step N. */
function stageByRole(chain, role) {
  const inserts = chain?.inserts || [];
  const idx = inserts.findIndex((s) => s.role === role);
  if (idx < 0) return null;
  return { index: idx + 1, title: inserts[idx].title || role, role };
}

function stageName(chain, role, fallback) {
  return stageByRole(chain, role)?.title || fallback;
}

function rebuildOrderWhy(chain, target) {
  const inserts = (chain?.inserts || []).map((s) => s.title).filter(Boolean);
  const sends = (chain?.sends || []).map((s) => s.title).filter(Boolean);
  const tip =
    target === "instrumental"
      ? "Carve and mono the lows before glue or width — locking mud into compression is hard to undo."
      : target === "full"
        ? "Corrective EQ first, then glue, then width, then limiting. Brightening last is how bus chains fall apart."
        : "Cut mud and harshness before compressing. De-ess after compression — compressors make S’s louder.";
  return { inserts, sends, tip };
}

function buildHighlights(chain, liveTraits, readout, target) {
  const highlights = [];
  const add = (stage, action, because) => {
    if (!stage || !action) return;
    highlights.push({
      stage,
      action,
      because: because || "",
      title: stage,
      body: action,
      characteristic: stage,
      why: because || action,
    });
  };

  const mudHz = readout?.eqTargets?.mudHz || 320;
  const harshHz = readout?.eqTargets?.harshHz || 3200;
  const deessHz = readout?.eqTargets?.deessHz || 6500;
  const eqStage = stageName(chain, "eq_subtractive", "Subtractive EQ");
  const deessStage = stageName(chain, "deess", "De-esser");
  const comp1 = stageName(chain, "comp1", "Compressor 1");
  const comp2 = stageName(chain, "comp2", "Compressor 2");

  if (target === "vocal") {
    if (liveTraits.tone.mud === "elevated") {
      add(
        eqStage,
        `Cut around ${mudHz} Hz to clear muddy low-mids — do this before any compression.`,
        "We measured elevated mud in the vocal region."
      );
    }
    if (liveTraits.tone.harshness === "elevated") {
      add(
        eqStage,
        `Cut around ${harshHz} Hz to ease upper-mid bite.`,
        "Upper mids measured harsh on this reference."
      );
    }
    if (liveTraits.tone.sibilance === "elevated") {
      add(
        deessStage,
        `Tame S and T sounds around ${deessHz} Hz after you compress.`,
        "Sibilance measured hot — compressors will make it worse if you skip this."
      );
    }
    if (liveTraits.dynamics === "heavily_limited" || liveTraits.dynamics === "controlled") {
      add(
        comp1,
        `Use ${comp1} and ${comp2} gently in series — not one heavy limiter on the lead.`,
        "The vocal region is already dense."
      );
    }
  } else {
    if (liveTraits.tone.mud === "elevated" || (readout.toneFull?.mud ?? -99) > -2) {
      add(
        stageName(chain, "eq_subtractive", "Corrective EQ"),
        "High-pass non-bass groups and carve kick/bass so the midrange can breathe.",
        "Low end is masking the mix."
      );
    }
    if (liveTraits.tone.harshness === "elevated" || (readout.toneFull?.harshness ?? -99) > -6) {
      add(
        stageName(chain, "eq_subtractive", "Corrective EQ"),
        "Tame hats and cymbals before you add air or brightness.",
        "Top end measured harsh."
      );
    }
    if (liveTraits.dynamics === "heavily_limited" || liveTraits.dynamics === "controlled") {
      add(
        stageName(chain, "comp1", "Bus glue"),
        "Add only 1–2 dB of bus glue. Don’t slam another limiter on the bus.",
        "The mix is already dense."
      );
    }
    if (liveTraits.stereo === "wide" || readout.stereo.sideMidRatio > 0.22) {
      add(
        stageName(chain, "width", "Width"),
        "Keep lows mono. Open width by band on the highs — not with one widener on everything.",
        "Stereo image measures wide."
      );
    }
  }

  return highlights;
}

/**
 * Full chain + short corrective highlights for the UI.
 * @param {'standard' | 'deep'} [mode]
 * @param {'vocal' | 'instrumental' | 'full'} [target]
 */
export function recommend(traits, pluginMap, daw = "universal", readout = null, mode = "standard", target = "vocal") {
  if (!readout) {
    return {
      daw,
      mode,
      target: normalizeTarget(target),
      honesty: "Need a readout to dial the chain.",
      chain: null,
      steps: [],
    };
  }

  const resolvedTarget = normalizeTarget(target || readout.target || "vocal");
  const deep = mode === "deep";
  const liveTraits = deep ? deepenTraits(readout, traits) : traits;
  let chain = buildChainForTarget(resolvedTarget, readout, liveTraits, daw);

  if (deep && resolvedTarget === "vocal") {
    const extras = deepVocalExtras(readout, liveTraits);
    const sendExtras = deepSendExtras(readout, liveTraits);
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
  } else if (deep) {
    chain = attachAffiliates(chain);
    chain.honesty =
      resolvedTarget === "instrumental"
        ? "Deep instrumental recreation — bed EQ, glue, and width from the measured balance. Not the original session."
        : "Deep full-mix recreation — mix-bus order plus Master delivery checklist. Not the original session.";
  }

  chain = {
    ...chain,
    orderWhy: rebuildOrderWhy(chain, resolvedTarget),
  };

  const highlights = buildHighlights(chain, liveTraits, readout, resolvedTarget);

  const master = deep ? buildMasterAnalysis(readout, liveTraits) : null;
  const design = deep && resolvedTarget === "vocal" ? buildDesignBrief(readout, liveTraits) : null;

  return {
    daw: "universal",
    mode,
    target: resolvedTarget,
    honesty: chain.honesty,
    estimateNote: chain.estimateNote,
    chain,
    master,
    design,
    instruments: readout.instruments || liveTraits.instruments || [],
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
