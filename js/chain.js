/**
 * Build a full, ordered vocal mix chain from measured traits + readout.
 * Plugin names are DAW-agnostic — match the same roles in whatever you own.
 *
 * Honesty: plausible reconstruction from measurements — not the true chain.
 */

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

function dials(...pairs) {
  return pairs.filter(Boolean).map(([label, value]) => ({ label, value }));
}

/**
 * Dial numeric targets from the readout (still estimates).
 */
export function dialFromReadout(readout, traits) {
  const mud = readout.tone.mud;
  const harsh = readout.tone.harshness;
  const sib = readout.tone.sibilance;
  const air = readout.tone.air;
  const crest = readout.dynamics.crestDb;
  const sideMid = readout.stereo.sideMidRatio;

  const mudCut =
    traits.tone.mud === "elevated" ? clamp(2 + mud * 0.35, 2, 4.5) :
    traits.tone.mud === "recessed" ? 0.5 :
    1.5;

  const harshCut =
    traits.tone.harshness === "elevated" ? clamp(1.5 + Math.abs(harsh) * 0.08, 1.5, 3.5) :
    1.0;

  const deessDb =
    traits.tone.sibilance === "elevated" ? clamp(4 + sib * 0.4, 4, 8) :
    traits.tone.sibilance === "recessed" ? 2 :
    3.5;

  const airShelf =
    traits.tone.air === "elevated" ? clamp(-1.5 - Math.abs(air) * 0.02, -3, -0.5) :
    traits.tone.air === "recessed" ? clamp(1.5 + Math.abs(air) * 0.02, 1, 3.5) :
    1.0;

  let comp1Gr, comp1Attack, comp1Ratio, serial;
  if (crest < 6) {
    comp1Gr = 5;
    comp1Attack = 8;
    comp1Ratio = 4;
    serial = true;
  } else if (crest < 9) {
    comp1Gr = 4;
    comp1Attack = 10;
    comp1Ratio = 3.5;
    serial = true;
  } else if (crest < 14) {
    comp1Gr = 3;
    comp1Attack = 12;
    comp1Ratio = 3;
    serial = false;
  } else {
    comp1Gr = 2;
    comp1Attack = 18;
    comp1Ratio = 2.5;
    serial = false;
  }

  const satDrive =
    traits.dynamics === "heavily_limited" || traits.tone.air === "recessed" ? "low–medium" : "low";

  const widthMode =
    traits.stereo === "wide" ? "fx_wide" :
    traits.stereo === "narrow" ? "center" :
    "focused";

  const verbSize = sideMid > 0.25 ? "Plate / short room" : "Short plate, tucked";
  const useMod = traits.stereo === "wide" || sideMid > 0.28;

  return {
    hpfHz: 80,
    mudHz: 320,
    mudCutDb: round1(mudCut),
    mudQ: 1.2,
    harshHz: 3200,
    harshCutDb: round1(harshCut),
    harshQ: 0.85,
    presenceHz: 4500,
    presenceDb: traits.tone.harshness === "elevated" ? 0 : 1.5,
    deessHz: 6500,
    deessGrDb: round1(deessDb),
    airHz: 11000,
    airShelfDb: round1(airShelf),
    comp1: {
      ratio: comp1Ratio,
      attackMs: comp1Attack,
      releaseMs: 65,
      grDb: comp1Gr,
    },
    serial,
    satDrive,
    limitCatchDb: crest < 8 ? 2 : 1.5,
    widthMode,
    verbSize,
    useMod,
    preDelayMs: sideMid > 0.25 ? 28 : 20,
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
      traits.tone.mud === "elevated" ? ["Focus", "Deeper mud cut — reference is low-mid heavy"] : null
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
    why: "Cut before you compress. Compressing muddy or harsh energy glues the problem into every syllable.",
    how: "Sweep cuts with a narrow Q to find the ugly spot, then widen Q and use less cut. A/B at mix level, not solo.",
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
      ["Time", "1/8 or dotted 1/8 · low feedback (15–25%)"],
      ["Filter", "Low-pass the return ~4–5 kHz"],
      ["Move", "Ride send on phrase ends — not 100% wet on the lead"]
    ),
    visual: {
      kind: "delay",
      time: "1/8 or dotted 1/8",
      feedbackPct: 20,
      lowpassHz: 4500,
    },
    copy: [
      "Time: 1/8 or dotted 1/8",
      "Feedback 15–25%",
      "Low-pass the return around 4–5 kHz",
      "Send on phrase ends — not always on",
    ],
    why: "Pros put space on sends. Delay creates depth and width without smearing the dry lead.",
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
      "Engineered recreation from the measured vocal signature — match these roles and settings in whatever plugins you own. Not a claim these were the exact plugins on the record.",
    estimateNote:
      "Dialed from the vocal region of a finished master. Build the stages in order, set the values, then refine by ear in full mix context.",
    dial: d,
    signalFlow,
    sendFlow,
    orderWhy: [
      `Insert order: ${signalFlow.join(" → ")}`,
      `Sends: ${sendFlow.join(" → ")}`,
      "Brightening before de-ess, or compressing muddy mids, is how unfinished chains fall apart.",
    ],
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
