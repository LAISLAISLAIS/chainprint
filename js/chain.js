/**
 * Build a full, ordered vocal mix chain from measured traits + readout.
 * Plugin names are DAW-agnostic — match the same roles in whatever you own.
 *
 * Honesty: plausible reconstruction from measurements — not the true chain.
 */

import { pickDelayNote, noteMs } from "./dsp/tempo.js";

const PLUGINS = {
  gain: "Gain / Utility",
  eq: "Parametric EQ",
  deess: "De-esser",
  comp: "Compressor",
  comp2: "Compressor (serial)",
  sat: "Saturator",
  limit: "Limiter",
  delay: "Stereo / Tape Delay",
  verb: "Plate / Hall Reverb",
  mod: "Chorus",
  width: "Doubles bus / Utility",
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round0(n) {
  return Math.round(n);
}

function dials(...pairs) {
  return pairs.filter(Boolean).map(([label, value]) => ({ label, value }));
}

/**
 * Dial numeric targets from continuous readout (not just 3-way labels).
 * Frequencies come from measured spectral peaks; amounts from tone/dyn indices.
 */
export function dialFromReadout(readout, traits) {
  const mud = readout.tone.mud;
  const harsh = readout.tone.harshness;
  const sib = readout.tone.sibilance;
  const air = readout.tone.air;
  const crest = readout.dynamics.crestDb;
  const range = readout.dynamics.shortTermRangeDb ?? 8;
  const sideMid = readout.stereo.sideMidRatio;
  const corr = readout.stereo.correlation;
  const centroid = readout.centroidHz || 2500;
  const ti = readout.transientIndex ?? 0;
  const targets = readout.eqTargets || {};
  const f0 = readout.pitch?.f0Hz;
  const register = readout.pitch?.register || traits.pitch?.register || "mid";
  const bpmRaw = readout.tempo?.bpm || traits.tempo?.bpm || null;
  const bpmReliable = readout.tempo?.reliable ?? traits.tempo?.reliable ?? false;
  const bpm = bpmReliable ? bpmRaw : null;
  const feel = bpm ? readout.tempo?.feel || traits.tempo?.feel || null : null;
  const keyReliable = readout.pitch?.keyReliable ?? false;

  // Continuous cuts — every song gets a unique amount from its indices
  const mudCut = clamp(1.1 + (mud - -4) * 0.42, 0.3, 5.8);
  const harshCut = clamp(0.7 + (harsh - -8) * 0.28, 0.25, 4.2);
  const deessDb = clamp(2.4 + (sib - -6) * 0.55, 1.2, 9);
  // Elevated air (higher index) → less shelf / slight cut; recessed → more boost
  const airShelf = clamp(-0.18 * (air - -13), -3.8, 3.6);
  const presenceDb = clamp(1.9 - Math.max(0, harsh + 7) * 0.32 - Math.max(0, sib + 4) * 0.12, 0, 3.2);

  // HPF tracks vocal register + mud weight (only trust measured F0 when reliable)
  let hpfHz = register === "low" ? 68 : register === "high" ? 105 : 85;
  if (Number.isFinite(f0) && readout.pitch?.f0Reliable) {
    hpfHz = clamp(52 + f0 * 0.2, 55, 125);
  }
  hpfHz = clamp(hpfHz + Math.max(0, mud + 2) * 3.5, 55, 130);

  const mudHz = round0(clamp(targets.mudHz || 320, 200, 420));
  const harshHz = round0(clamp(targets.harshHz || 3200, 2400, 4200));
  const presenceHz = round0(clamp(targets.presenceHz || 4500, 3000, 5200));
  const deessHz = round0(clamp(targets.deessHz || 6500, 4800, 9000));
  let airHz = round0(clamp(targets.airHz || 11000, 9000, 14000));
  // Brighter centroids → slightly higher air hinge
  if (centroid > 3200) airHz = round0(clamp(airHz + 400, 9000, 14500));

  const mudQ = round1(clamp(0.95 + Math.max(0, mud) * 0.05, 0.8, 1.6));
  const harshQ = round1(clamp(0.7 + Math.max(0, harsh + 6) * 0.04, 0.55, 1.35));

  // Continuous compression from crest + short-term range + transients
  const comp1Gr = round1(clamp(6.8 - crest * 0.38 - Math.max(0, range - 10) * 0.08, 1.4, 6.2));
  const comp1Attack = round0(clamp(5 + crest * 1.05 - Math.max(0, ti) * 0.35, 4, 28));
  const comp1Ratio = round1(clamp(5.4 - crest * 0.2, 2.2, 5.2));
  const serial = crest < 9.5 || (crest < 11 && range < 7);
  // Release tracks tempo when available (shorter on faster songs)
  const beatMs = bpm ? noteMs(bpm, 0.25) : 90;
  const releaseMs = round0(
    clamp((beatMs || 90) * 0.55 + crest * 2.2, 35, 200)
  );

  const satAmt = clamp(
    0.35 +
      (traits.dynamics === "heavily_limited" ? 0.45 : 0) +
      (air < -16 ? 0.35 : 0) +
      (crest < 8 ? 0.25 : 0) +
      Math.max(0, -ti) * 0.04,
    0.2,
    1.4
  );
  const satDrive =
    satAmt >= 1.05 ? "medium" : satAmt >= 0.7 ? "low–medium" : "low";

  const widthMode =
    sideMid > 0.32 || corr < 0.45
      ? "fx_wide"
      : sideMid < 0.09 && corr > 0.85
        ? "center"
        : "focused";

  const verbSize =
    sideMid > 0.3
      ? "Hall / ambient plate"
      : sideMid > 0.18
        ? "Plate / short room"
        : bpm && bpm < 90
          ? "Short plate, intimate"
          : "Short plate, tucked";

  const useMod = sideMid > 0.24 || corr < 0.55 || traits.stereo === "wide";

  const delay = pickDelayNote(bpm, feel);
  const preDelayMs = round0(
    clamp(
      (sideMid > 0.22 ? 24 : 14) + (bpm ? clamp(60000 / bpm / 16, 8, 40) : 12) + crest * 0.4,
      12,
      55
    )
  );

  const limitCatchDb = round1(clamp(3.4 - crest * 0.22, 0.8, 3.2));

  return {
    hpfHz: round0(hpfHz),
    mudHz,
    mudCutDb: round1(mudCut),
    mudQ,
    harshHz,
    harshCutDb: round1(harshCut),
    harshQ,
    presenceHz,
    presenceDb: round1(presenceDb),
    deessHz,
    deessGrDb: round1(deessDb),
    airHz,
    airShelfDb: round1(airShelf),
    comp1: {
      ratio: comp1Ratio,
      attackMs: comp1Attack,
      releaseMs,
      grDb: comp1Gr,
    },
    serial,
    satDrive,
    satAmt: round1(satAmt),
    limitCatchDb,
    widthMode,
    verbSize,
    useMod,
    preDelayMs,
    bpm: bpmRaw,
    bpmReliable,
    delayLabel: delay.label,
    delayMs: delay.ms,
    keyLabel: keyReliable ? readout.pitch?.keyLabel || null : null,
    register,
  };
}

function step(cfg) {
  return {
    tier: "stock",
    ...cfg,
  };
}

/**
 * Always returns a complete insert chain + send suggestions.
 * Pro order: Gain → EQ (HPF/cuts) → Compression → De-ess → Saturation → Air EQ → Limit
 * Sends: Delay → Reverb → (Modulation / doubles)
 */
export function buildVocalChain(readout, traits, _daw = "universal") {
  const plugs = PLUGINS;
  const d = dialFromReadout(readout, traits);
  const inserts = [];

  inserts.push(step({
    role: "gain",
    type: "Gain",
    title: "Gain staging",
    plugin: plugs.gain,
    dials: dials(
      ["Target peaks", "−18 to −12 dBFS"],
      ["Headroom", "Leave 6–12 dB before the first EQ"]
    ),
    visual: {
      kind: "gain",
      peakLow: -18,
      peakHigh: -12,
      headroomDb: 9,
    },
    copy: [
      "Turn the clip/fader so loudest peaks sit around −18 to −12 dB",
      "Leave headroom — don’t clip into the first plugin",
    ],
    why: "Every compressor and saturator downstream behaves differently if the input is slammed or too quiet. Pros set level before they sculpt tone.",
    how: "Match the reference’s apparent loudness later with makeup — not by clipping the first insert.",
  }));

  inserts.push(step({
    role: "eq_subtractive",
    type: "EQ",
    title: "Subtractive EQ",
    plugin: plugs.eq,
    dials: dials(
      ["High-pass", `${d.hpfHz} Hz · 18–24 dB/oct`],
      ["Mud cut", `${d.mudHz} Hz · −${d.mudCutDb} dB · Q ${d.mudQ}`],
      ["Harsh cut", `${d.harshHz} Hz · −${d.harshCutDb} dB · Q ${d.harshQ}`],
      d.register && d.register !== "unknown"
        ? ["Register", `${d.register} vocal · HPF from measured pitch`]
        : null,
      d.mudCutDb >= 2.5 ? ["Focus", "Deeper mud cut — this ref is low-mid heavy"] : null
    ),
    visual: {
      kind: "eq",
      bands: [
        { id: "hpf", type: "hpf", freq: d.hpfHz, slope: 24, label: "High-pass" },
        { id: "mud", type: "bell", freq: d.mudHz, gain: -d.mudCutDb, q: d.mudQ, label: "Mud cut" },
        { id: "harsh", type: "bell", freq: d.harshHz, gain: -d.harshCutDb, q: d.harshQ, label: "Harsh cut" },
      ],
    },
    copy: [
      `High-pass at ${d.hpfHz} Hz (steep)`,
      `Cut mud: ${d.mudHz} Hz, −${d.mudCutDb} dB, Q ${d.mudQ}`,
      `Cut harsh: ${d.harshHz} Hz, −${d.harshCutDb} dB, Q ${d.harshQ}`,
    ],
    why: "Cut before you compress. Frequencies are placed on this track’s measured peaks — not a generic preset.",
    how: "Sweep ±200 Hz around the suggested centers to confirm, then widen Q and use less cut. A/B at mix level, not solo.",
  }));

  inserts.push(step({
    role: "comp1",
    type: "Compression",
    title: "Compressor — leveler",
    plugin: plugs.comp,
    dials: dials(
      ["Ratio", `${d.comp1.ratio}:1`],
      ["Attack", `${d.comp1.attackMs} ms`],
      ["Release", `~${d.comp1.releaseMs} ms (or Auto)`],
      ["Gain reduction", `~${d.comp1.grDb} dB on phrases`],
      ["Makeup", "Match bypass loudness before judging"]
    ),
    visual: {
      kind: "compressor",
      ratio: d.comp1.ratio,
      attackMs: d.comp1.attackMs,
      releaseMs: d.comp1.releaseMs,
      grDb: d.comp1.grDb,
      knee: "soft",
    },
    copy: [
      `Ratio ${d.comp1.ratio}:1`,
      `Attack ${d.comp1.attackMs} ms · Release ~${d.comp1.releaseMs} ms`,
      `Aim for ~${d.comp1.grDb} dB gain reduction on phrases`,
      "Makeup gain: match loudness to bypass, then listen",
    ],
    why:
      traits.dynamics === "heavily_limited" || traits.dynamics === "controlled"
        ? "This reference’s vocal region is dense (low crest). Pros get that with serial compression — two gentle stages — not one slammed plugin."
        : "Crest still has life. Level phrases without crushing consonants.",
    how: "GR should move with the performance. If the meter parks at full scale, raise the threshold.",
  }));

  if (d.serial) {
    inserts.push(step({
      role: "comp2",
      type: "Compression",
      title: "Compressor — density",
      plugin: plugs.comp2,
      dials: dials(
        ["Mode", "Faster attack than Comp 1 · ratio 2:1–3:1"],
        ["Gain reduction", "1–3 dB only"],
        ["Goal", "Glue / radio density — not pumping"]
      ),
      visual: {
        kind: "compressor",
        ratio: 2.5,
        attackMs: Math.max(4, d.comp1.attackMs - 4),
        releaseMs: 80,
        grDb: 2,
        knee: "soft",
      },
      copy: [
        "Faster attack than Comp 1, ratio ~2.5:1",
        "Only 1–3 dB of gain reduction",
        "Should feel glued, not pumping",
      ],
      why: "Dense contemporary vocals are usually two compressors in series. The second stage is subtle on purpose.",
      how: "If you hear pumping, slow Comp 1 attack or pull Comp 2 GR back to 1 dB.",
    }));
  }

  inserts.push(step({
    role: "deess",
    type: "De-Esser",
    title: "De-esser",
    plugin: plugs.deess,
    dials: dials(
      ["Center freq", `~${d.deessHz} Hz`],
      ["Reduction", `~${d.deessGrDb} dB on S peaks only`],
      ["Rule", "If lyrics lisp, raise threshold — dead-S sounds amateur"]
    ),
    visual: {
      kind: "deesser",
      freq: d.deessHz,
      reductionDb: d.deessGrDb,
    },
    copy: [
      `Frequency ~${d.deessHz} Hz`,
      `Reduce ~${d.deessGrDb} dB on S peaks only`,
      "If it lisps, raise the threshold",
    ],
    why: "Compression lifts sibilance. De-ess after the leveler so you’re taming what the mix will actually hear.",
    how: "Ride only the loudest S/T syllables against the reference. Match bite — don’t erase presence.",
    paid: {
      plugin: "FabFilter Pro-DS",
      notes: "Reach for this if stock de-essors dull the top while still lisping.",
    },
  }));

  inserts.push(step({
    role: "sat",
    type: "Saturation",
    title: "Saturation / harmonics",
    plugin: plugs.sat,
    dials: dials(
      ["Drive", d.satDrive],
      ["Character", "Soft / warm / tape if available"],
      ["Output", "Blend so peak barely rises"],
      traits.tone.air === "recessed"
        ? ["Tip", "Mild sat can create air-like harmonics without a huge shelf"]
        : ["Tip", "If you notice it immediately, it’s too much"]
    ),
    visual: {
      kind: "saturator",
      drive: d.satDrive,
      character: "warm",
    },
    copy: [
      `Drive: ${d.satDrive}`,
      "Soft / warm / tape character",
      "Blend until you barely notice it",
    ],
    why: "A lot of ‘expensive’ vocal density is soft saturation and harmonics — not only EQ shelves.",
    how: "Bypass often. Saturation should disappear into the tone, not announce itself as distortion.",
  }));

  inserts.push(step({
    role: "eq_air",
    type: "EQ",
    title: "Presence & air",
    plugin: plugs.eq,
    dials: dials(
      d.presenceDb > 0
        ? ["Presence", `${d.presenceHz} Hz · +${d.presenceDb} dB · wide bell`]
        : ["Presence", "Skip boost — harshness already elevated"],
      ["Air shelf", `~${d.airHz} Hz · ${d.airShelfDb > 0 ? "+" : ""}${d.airShelfDb} dB`],
      ["Order", "Only after de-ess"]
    ),
    visual: {
      kind: "eq",
      bands: [
        ...(d.presenceDb > 0
          ? [{ id: "pres", type: "bell", freq: d.presenceHz, gain: d.presenceDb, q: 0.7, label: "Presence" }]
          : []),
        { id: "air", type: "highshelf", freq: d.airHz, gain: d.airShelfDb, label: "Air" },
      ],
    },
    copy: [
      ...(d.presenceDb > 0
        ? [`Presence: ${d.presenceHz} Hz, +${d.presenceDb} dB, wide`]
        : ["Skip presence boost"]),
      `Air shelf: ~${d.airHz} Hz, ${d.airShelfDb > 0 ? "+" : ""}${d.airShelfDb} dB`,
      "Do this only after de-essing",
    ],
    why:
      d.airShelfDb >= 0
        ? "Reference sits a touch dark up top — open air gently once sibilance is under control."
        : "Reference air is already forward. Don’t stack sparkle; you may need a tiny cut instead.",
    how: "Match by ear at the same perceived loudness as the reference. If S flares, pull the shelf 1 dB and revisit the de-esser.",
  }));

  inserts.push(step({
    role: "limit",
    type: "Limiter",
    title: "Peak control",
    plugin: plugs.limit,
    dials: dials(
      ["Catch", `~${d.limitCatchDb} dB of peaks`],
      ["True peak", "On / oversampling if available"],
      ["Optional", "Soft clip before limiter for denser edge"]
    ),
    visual: {
      kind: "limiter",
      catchDb: d.limitCatchDb,
      truePeak: true,
    },
    copy: [
      `Catch about ${d.limitCatchDb} dB of peaks`,
      "Turn True Peak / oversampling on if you have it",
    ],
    why: "Modern vocal regions are often limited into a low crest. Do this last — after tone and density are right.",
    how: "If consonants spit, reduce catch or ease the density compressor.",
  }));

  const sends = [];

  sends.push(step({
    role: "delay",
    type: "Delay",
    title: "Delay send",
    plugin: plugs.delay,
    dials: dials(
      d.bpmReliable && d.bpm && d.delayMs
        ? ["Time", `${d.delayLabel} · ${d.delayMs} ms @ ${d.bpm} BPM`]
        : ["Time", `${d.delayLabel || "1/8 or dotted 1/8"} · set to song tempo in your DAW`],
      ["Feedback", "15–25%"],
      ["Filter", "Low-pass the return ~4–5 kHz"],
      ["Move", "Ride send on phrase ends — not 100% wet on the lead"],
      d.keyLabel ? ["Key note", `Song center ≈ ${d.keyLabel}`] : null
    ),
    visual: {
      kind: "delay",
      time: d.bpmReliable && d.bpm && d.delayMs ? `${d.delayLabel} (${d.delayMs} ms)` : d.delayLabel || "1/8",
      feedbackPct: 20,
      lowpassHz: 4500,
    },
    copy: [
      d.bpmReliable && d.bpm && d.delayMs
        ? `Time: ${d.delayLabel} = ${d.delayMs} ms at ${d.bpm} BPM`
        : `Time: ${d.delayLabel || "1/8 or dotted 1/8"} — confirm BPM in your DAW`,
      "Feedback 15–25%",
      "Low-pass the return around 4–5 kHz",
      "Send on phrase ends — not always on",
    ],
    why: d.bpmReliable && d.bpm
      ? `Delay is tempo-synced to the measured ~${d.bpm} BPM pulse — still A/B against your grid.`
      : "Pros put space on sends. Delay creates depth and width without smearing the dry lead.",
    how: "HPF/LPF the return hard. Bright delay tails compete with S’s and air.",
  }));

  sends.push(step({
    role: "reverb",
    type: "Reverb",
    title: "Reverb send",
    plugin: plugs.verb,
    dials: dials(
      ["Type / size", d.verbSize],
      ["Pre-delay", `${d.preDelayMs} ms`],
      ["Return EQ", "HPF the return hard — verb mud kills the pocket"]
    ),
    visual: {
      kind: "reverb",
      size: d.verbSize,
      preDelayMs: d.preDelayMs,
    },
    copy: [
      `Type: ${d.verbSize}`,
      `Pre-delay: ${d.preDelayMs} ms`,
      "High-pass the reverb return hard",
    ],
    why:
      d.widthMode === "fx_wide"
        ? "Wider side energy on the reference — let FX returns carry space and width."
        : "Keep the lead centered. Reverb/delay create depth without stereo smear on the main take.",
    how: "You should feel space before you ‘hear a reverb plugin.’ If it’s obvious, pull the send.",
  }));

  if (d.useMod) {
    sends.push(step({
      role: "mod",
      type: "Modulation",
      title: "Chorus / width FX",
      plugin: plugs.mod,
      dials: dials(
        ["Placement", "Send / return — never 100% wet on the lead"],
        ["Depth", "Subtle · slow rate"],
        ["Mix", "Just enough to thicken doubles / pads around the vocal"]
      ),
      visual: { kind: "modulation", depth: "subtle", rate: "slow" },
      copy: [
        "Put on a send — never 100% wet on the lead",
        "Slow rate, subtle depth",
      ],
      why: "This reference’s stereo image is wide. Modulation and doubles usually create that — not a widener on a mono lead.",
      how: "If the lead gets watery or out of tune, pull the send. Keep the dry vocal mono and solid.",
    }));
  }

  sends.push(step({
    role: "width",
    type: d.widthMode === "center" ? "Width" : "Doubles",
    title: d.widthMode === "center" ? "Keep the lead centered" : "Doubles / stereo image",
    plugin: plugs.width,
    dials:
      d.widthMode === "center"
        ? dials(
            ["Lead", "Mono / center · width ≈ 0"],
            ["Wideners", "Skip on the main vocal"],
            ["Optional", "Touch of short delay if it feels stuck"]
          )
        : dials(
            ["Lead", "Centered"],
            ["Doubles", "Real or stacked takes · pan L/R · quieter than lead"],
            ["Never", "Stereo widener on the mono lead to ‘match’ a wide master"]
          ),
    visual: {
      kind: "width",
      mode: d.widthMode,
    },
    copy:
      d.widthMode === "center"
        ? ["Keep the lead mono / centered", "No widener on the main vocal"]
        : ["Lead stays centered", "Add quieter doubles panned L/R", "Don’t widen the mono lead"],
    why:
      d.widthMode === "center"
        ? "Vocal region measures narrow — respect the center pocket."
        : "Side energy on finished records is usually arrangement + FX returns, not a widener on the lead.",
    how: "Check in mono. If the vocal disappears or phases, your width move is wrong.",
  }));

  const signalFlow = inserts.map((s) => s.type).filter((t, i, a) => a.indexOf(t) === i);
  const sendFlow = [...new Set(sends.map((s) => s.type))];

  return {
    daw: "universal",
    honesty:
      "Built from what we measured on this reference. Match the roles and settings in your own plugins — this is not a claim these were the exact plugins on the record.",
    estimateNote:
      "From the vocal region of a finished master. Build stages in order, set the values, then refine by ear in the full mix.",
    dial: d,
    signalFlow,
    sendFlow,
    orderWhy: [
      `Build inserts in this order: ${inserts.map((s) => s.title).join(" → ")}.`,
      sends.length ? `Then sends: ${sends.map((s) => s.title).join(" → ")}.` : null,
      "Cut mud and harshness before compressing. De-ess after compression — compressors make S’s louder.",
    ].filter(Boolean),
    inserts,
    sends,
    paidUpgrades: [
      {
        when: "Stock de-ess dulls air or lisps",
        plugin: "FabFilter Pro-DS or oeksound soothe2",
      },
      {
        when: "You want finer dynamic EQ / limiting",
        plugin: "FabFilter Pro-Q 4 / Pro-C 2 / Pro-L 2 — after this chain gets you most of the way",
      },
    ],
  };
}
