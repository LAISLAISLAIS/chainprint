/**
 * Instrumental bed + full-mix / mix-bus chain builders.
 * Same honesty rule as vocals: plausible reconstruction from measurements.
 */

import { dialFromReadout } from "./chain.js";
import { pickDelayNote } from "./dsp/tempo.js";

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

function step(cfg) {
  return { tier: "stock", ...cfg };
}

function bandRel(bands, id) {
  const b = (bands || []).find((x) => x.id === id);
  return b?.dbRelTotal ?? -12;
}

/**
 * Dial targets tuned for instrumental / mix-bus work.
 */
export function dialInstrumental(readout, traits) {
  const base = dialFromReadout(readout, traits);
  const bands = readout.bandsFullMix || readout.bands || [];
  const sub = bandRel(bands, "sub");
  const bass = bandRel(bands, "bass");
  const brilliance = bandRel(bands, "brilliance");
  const air = bandRel(bands, "air");
  const crest = readout.dynamics.crestDb;
  const side = readout.stereo.sideMidRatio;
  const corr = readout.stereo.correlation;
  const ti = readout.transientIndexFull ?? readout.transientIndex ?? 0;
  const tone = readout.toneFull || readout.tone;

  const lowShelfCut = round1(clamp(0.4 + Math.max(0, sub + 10) * 0.12, 0.3, 2.2));
  const kickBassCarve = round0(clamp(base.mudHz || 280, 180, 380));
  const hatCutHz = round0(clamp(readout.eqTargets?.harshHz || 5500, 4500, 8000));
  const hatCutDb = round1(clamp(0.5 + Math.max(0, (tone.harshness ?? -8) + 6) * 0.25 + (ti > 5 ? 0.4 : 0), 0.3, 3.5));
  const glueGr = round1(clamp(2.8 - crest * 0.12, 0.6, 2.4));
  const glueAttack = round0(clamp(18 + crest * 1.2, 10, 40));
  const widthHz = side > 0.28 ? 180 : 120;
  const satDrive =
    crest < 8 ? "low–medium" : brilliance > -10 || air > -12 ? "low" : "very low";
  const limitCatch = round1(clamp(2.8 - crest * 0.15, 0.6, 2.8));
  const vocalPocket = round0(clamp(readout.eqTargets?.presenceHz || 3200, 2500, 4500));

  return {
    ...base,
    lowShelfCut,
    kickBassCarve,
    hatCutHz,
    hatCutDb,
    glueGr,
    glueAttack,
    widthHz,
    satDrive,
    limitCatchDb: limitCatch,
    vocalPocket,
    bassHeavy: bass > -9 || sub > -10,
    wideBed: side > 0.22 || corr < 0.55,
  };
}

/**
 * Instrumental mix chain: Gain → EQ → Bus glue → Sat → Width → Limit + space sends.
 */
export function buildInstrumentalChain(readout, traits, _daw = "universal") {
  const d = dialInstrumental(readout, traits);
  const inserts = [];

  inserts.push(
    step({
      role: "gain",
      type: "Gain",
      title: "Bus gain staging",
      plugin: "Gain / Utility",
      dials: dials(
        ["Peaks", "−18 to −12 dBFS into the first insert"],
        ["Headroom", "Leave room for glue + limiter"]
      ),
      visual: { kind: "gain", peakLow: -18, peakHigh: -12, headroomDb: 9 },
      copy: ["Stage the instrumental bus so peaks sit around −18 to −12 dBFS"],
      why: "Bus compressors and imagers need consistent input level — same rule as vocal chains.",
      how: "Match perceived loudness later with makeup, not by clipping into EQ.",
    })
  );

  inserts.push(
    step({
      role: "eq_subtractive",
      type: "EQ",
      title: "Subtractive bed EQ",
      plugin: "Parametric EQ",
      dials: dials(
        ["High-pass", `${d.hpfHz} Hz on non-bass groups · keep kick/bass full`],
        ["Kick/bass carve", `${d.kickBassCarve} Hz · −${d.lowShelfCut}–${round1(d.lowShelfCut + 1)} dB if they fight`],
        ["Vocal pocket", `${d.vocalPocket} Hz · −1 to −2.5 dB wide if a vocal will sit on top`],
        ["Hat bite", `${d.hatCutHz} Hz · −${d.hatCutDb} dB · Q ~0.8`],
        d.bassHeavy ? ["Focus", "Low end is forward — prioritize mono lows + carve"] : null
      ),
      visual: {
        kind: "eq",
        bands: [
          { id: "hpf", type: "hpf", freq: d.hpfHz, slope: 18, label: "Group HPF" },
          { id: "carve", type: "bell", freq: d.kickBassCarve, gain: -d.lowShelfCut, q: 1.1, label: "Carve" },
          { id: "pocket", type: "bell", freq: d.vocalPocket, gain: -1.5, q: 0.7, label: "Vocal pocket" },
          { id: "hats", type: "bell", freq: d.hatCutHz, gain: -d.hatCutDb, q: 0.8, label: "Hat cut" },
        ],
      },
      copy: [
        `Group HPF ~${d.hpfHz} Hz (not on kick/bass)`,
        `Carve ~${d.kickBassCarve} Hz if kick/bass mask`,
        `Leave a pocket near ${d.vocalPocket} Hz for vocals`,
        `Tame hats ~${d.hatCutHz} Hz (−${d.hatCutDb} dB)`,
      ],
      why: "Instrumental clarity comes from masking cuts and mono low end — not brightening everything.",
      how: "Sweep cuts in the full mix. If the bed thins out, widen Q and use less gain.",
    })
  );

  inserts.push(
    step({
      role: "comp1",
      type: "Compression",
      title: "Bus glue",
      plugin: "Bus compressor",
      dials: dials(
        ["Ratio", "2:1–4:1"],
        ["Attack", `${d.glueAttack} ms`],
        ["Release", `Auto or ~${d.comp1.releaseMs} ms`],
        ["GR", `~${d.glueGr} dB on peaks`],
        ["Mix", crestBlend(d)]
      ),
      visual: {
        kind: "compressor",
        ratio: 2.5,
        attackMs: d.glueAttack,
        releaseMs: d.comp1.releaseMs,
        grDb: d.glueGr,
        knee: "soft",
      },
      copy: [
        `Attack ~${d.glueAttack} ms · aim ~${d.glueGr} dB GR`,
        "SSL-style glue — feel, not smash",
      ],
      why: "1–2 dB of bus glue is what makes an instrumental feel finished without sounding limited.",
      how: "If the kick pumps, slow attack or lower GR. Parallel mix helps open beds.",
    })
  );

  inserts.push(
    step({
      role: "sat",
      type: "Saturation",
      title: "Bus saturation",
      plugin: "Saturator / tape",
      dials: dials(
        ["Drive", d.satDrive],
        ["Focus", "Even harmonics · low-mid body"],
        ["Blend", "Barely audible"]
      ),
      visual: { kind: "saturator", drive: d.satDrive, character: "warm" },
      copy: [`Drive: ${d.satDrive}`, "Warm / tape · blend until it disappears into the bed"],
      why: "Soft saturation densifies 808s and synths the way cheap brightening never will.",
      how: "Bypass often. If you hear crunch on hats, pull drive or filter the sat return.",
    })
  );

  inserts.push(
    step({
      role: "width",
      type: "Imaging",
      title: "Stereo image",
      plugin: "Multiband imager / Utility",
      dials: dials(
        ["Lows", `Mono / narrow below ~${d.widthHz} Hz`],
        ["Mids/highs", d.wideBed ? "Ease excess side in mids · open gently above 5 kHz" : "Optional +width above ~5 kHz"],
        ["Check", "Always flip to mono after width moves"]
      ),
      visual: { kind: "width", mode: d.wideBed ? "fx_wide" : "focused" },
      copy: [
        `Keep lows mono below ~${d.widthHz} Hz`,
        d.wideBed ? "This ref is wide — manage side energy by band" : "Subtle width only on the top",
      ],
      why: "Finished instrumentals manage width by band — wide bass is what collapses on phones.",
      how: "If the chorus disappears in mono, you over-widened the mids.",
    })
  );

  inserts.push(
    step({
      role: "limit",
      type: "Limiter",
      title: "Peak control",
      plugin: "Limiter",
      dials: dials(
        ["Catch", `~${d.limitCatchDb} dB`],
        ["Ceiling", "−1.0 dBTP if this prints as a stem"],
        ["Rule", "Don’t win a loudness war on the bed alone"]
      ),
      visual: { kind: "limiter", catchDb: d.limitCatchDb, truePeak: true },
      copy: [`Catch ~${d.limitCatchDb} dB of peaks`, "True peak on if delivering a stem"],
      why: "Light limiting cleans spikes after glue — heavy limiting belongs on the master, not every bus.",
      how: "If transients die, reduce catch and revisit glue GR.",
    })
  );

  const delay = pickDelayNote(d.bpmReliable ? d.bpm : null, readout.tempo?.feel);
  const sends = [
    step({
      role: "reverb",
      type: "Reverb",
      title: "Room / plate send",
      plugin: "Plate / Room",
      dials: dials(
        ["Type", d.verbSize],
        ["Pre-delay", `${d.preDelayMs} ms`],
        ["Return", "HPF hard · don’t muddy the low end"]
      ),
      visual: { kind: "reverb", size: d.verbSize, preDelayMs: d.preDelayMs },
      copy: [`${d.verbSize}`, `Pre-delay ${d.preDelayMs} ms`, "High-pass the return"],
      why: "Space on the bed should feel like a room, not a wash under the kick.",
      how: "Send on pads/guitars more than kick/bass.",
    }),
    step({
      role: "delay",
      type: "Delay",
      title: "Delay throws",
      plugin: "Stereo / Tape Delay",
      dials: dials(
        d.bpmReliable && d.bpm && delay.ms
          ? ["Time", `${delay.label} · ${delay.ms} ms @ ${d.bpm} BPM`]
          : ["Time", "1/8 or dotted 1/8 — lock to session tempo"],
        ["Feedback", "10–20%"],
        ["Filter", "LPF return ~5 kHz"]
      ),
      visual: {
        kind: "delay",
        time: d.bpmReliable && delay.ms ? `${delay.label} (${delay.ms} ms)` : delay.label || "1/8",
        feedbackPct: 15,
        lowpassHz: 5000,
      },
      copy: [
        d.bpmReliable && d.bpm && delay.ms
          ? `${delay.label} = ${delay.ms} ms @ ${d.bpm} BPM`
          : "Tempo-sync delay in your DAW",
        "Short feedback · dark returns",
      ],
      why: "Throw delays add motion without widening the entire bus.",
      how: "Ride sends on phrase ends — not 100% wet on the whole instrumental.",
    }),
  ];

  const signalFlow = inserts.map((s) => s.type).filter((t, i, a) => a.indexOf(t) === i);
  const sendFlow = [...new Set(sends.map((s) => s.type))];

  return {
    daw: "universal",
    target: "instrumental",
    honesty:
      "Engineered recreation of the instrumental bed from measured balance — match these roles in your plugins. Not a claim of the original chain.",
    estimateNote:
      readout.sourceKind === "stem"
        ? "Dialed from your instrumental stem. Build stages in order, then A/B in full mix context."
        : "Dialed from an instrumental-weighted read of the finished master. Upload a stem for higher accuracy.",
    dial: d,
    signalFlow,
    sendFlow,
    orderWhy: [
      `Insert order: ${signalFlow.join(" → ")}`,
      `Sends: ${sendFlow.join(" → ")}`,
      "Carve and mono lows before glue and width.",
    ],
    inserts,
    sends,
    paidUpgrades: [
      { when: "Need finer multiband glue", plugin: "FabFilter Pro-MB / SSL Bus+" },
      { when: "Imaging feels crude", plugin: "iZotope Imager / Ozone Imager" },
    ],
  };
}

function crestBlend(d) {
  return d.serial || (d.comp1?.grDb || 0) > 4 ? "40–70% wet if available" : "70–100% wet";
}

/**
 * Full-song mix-bus chain (pre-master): EQ → glue → imager → limiter.
 * Sends stay light; Deep Master tab carries delivery checklist.
 */
export function buildFullMixChain(readout, traits, _daw = "universal") {
  const d = dialInstrumental(readout, traits);
  const lufs = readout.loudness?.lufsProxy;
  const inserts = [];

  inserts.push(
    step({
      role: "gain",
      type: "Gain",
      title: "Mix-bus level",
      plugin: "Gain / Utility",
      dials: dials(
        ["Peaks", "Leave 3–6 dB before the limiter"],
        Number.isFinite(lufs) ? ["Loudness proxy", `≈ ${lufs.toFixed(1)} — verify with a real meter`] : null
      ),
      visual: { kind: "gain", peakLow: -12, peakHigh: -6, headroomDb: 6 },
      copy: ["Don’t clip the mix bus into the first EQ"],
      why: "Mix-bus processing assumes headroom. Loudness wars start when the bus is already slamming.",
      how: "Pull the master fader, not individual tracks, if you’re out of headroom.",
    })
  );

  inserts.push(
    step({
      role: "eq_subtractive",
      type: "EQ",
      title: "Mix-bus EQ",
      plugin: "Linear-phase or clean EQ",
      dials: dials(
        ["HPF", "20–30 Hz steep · clear infrasonics"],
        ["Low check", d.bassHeavy ? `Ease 80–120 Hz (−0.5 to −1.5 dB) if boomy` : "Low end looks controlled — tiny moves"],
        ["Vocal / mid", `Optional wide cut near ${d.vocalPocket} Hz if the midrange is crowded`],
        ["Top", `Hat / air control ~${d.hatCutHz} Hz (−${d.hatCutDb} dB) if fatiguing`]
      ),
      visual: {
        kind: "eq",
        bands: [
          { id: "hpf", type: "hpf", freq: 25, slope: 24, label: "Infra HPF" },
          { id: "low", type: "bell", freq: 100, gain: d.bassHeavy ? -1 : -0.3, q: 0.8, label: "Low check" },
          { id: "mid", type: "bell", freq: d.vocalPocket, gain: -0.8, q: 0.6, label: "Mid ease" },
          { id: "air", type: "highshelf", freq: d.airHz, gain: Math.min(1, d.airShelfDb), label: "Air" },
        ],
      },
      copy: [
        "HPF ~25 Hz",
        d.bassHeavy ? "Check boom 80–120 Hz" : "Subtle tonal balance only",
        `Watch fatigue near ${d.hatCutHz} Hz`,
      ],
      why: "Mix-bus EQ is subtractive first — fix translation before glue and limiting.",
      how: "A/B at matched loudness. If the chorus thins, you cut too much mid.",
    })
  );

  inserts.push(
    step({
      role: "comp1",
      type: "Compression",
      title: "Mix-bus glue",
      plugin: "SSL-style bus compressor",
      dials: dials(
        ["Ratio", "2:1"],
        ["Attack", `~${d.glueAttack} ms`],
        ["GR", `~${d.glueGr}–${round1(d.glueGr + 0.5)} dB`],
        ["Mix", crestBlend(d)]
      ),
      visual: {
        kind: "compressor",
        ratio: 2,
        attackMs: d.glueAttack,
        releaseMs: d.comp1.releaseMs,
        grDb: d.glueGr,
        knee: "soft",
      },
      copy: [`~${d.glueGr} dB GR · attack ${d.glueAttack} ms`, "Glue, don’t smash"],
      why: "Finished records usually have gentle mix-bus compression before the mastering limiter.",
      how: "If the groove pumps, back off GR or slow attack.",
    })
  );

  inserts.push(
    step({
      role: "width",
      type: "Imaging",
      title: "Stereo polish",
      plugin: "Multiband imager",
      dials: dials(
        ["Lows", `Mono below ~${d.widthHz} Hz`],
        ["Width", d.wideBed ? "Reduce excess side in mids" : "Optional lift above 5 kHz"],
        ["Mono", "Check every move"]
      ),
      visual: { kind: "width", mode: d.wideBed ? "fx_wide" : "focused" },
      copy: [`Mono lows < ${d.widthHz} Hz`, "Width by band only"],
      why: "Phone speakers and clubs expose phasey lows instantly.",
      how: "Collapse to mono on the chorus — lead and kick should stay solid.",
    })
  );

  inserts.push(
    step({
      role: "limit",
      type: "Limiter",
      title: "Mix-bus peak control",
      plugin: "Transparent limiter",
      dials: dials(
        ["Catch", `~${d.limitCatchDb} dB`],
        ["Ceiling", "−1.0 dBTP working ceiling"],
        ["Next", "Open Deep → Master for delivery loudness targets"]
      ),
      visual: { kind: "limiter", catchDb: d.limitCatchDb, truePeak: true },
      copy: [`Catch ~${d.limitCatchDb} dB`, "Leave final loudness to the mastering pass"],
      why: "Catch spikes here; print competitive loudness on the master chain.",
      how: "If crest collapses, you’re limiting too hard on the mix bus.",
    })
  );

  const sends = [
    step({
      role: "reverb",
      type: "Reverb",
      title: "Bus space (optional)",
      plugin: "Short plate / room",
      dials: dials(["Amount", "Very low · polish only"], ["Return EQ", "HPF + LPF the return"]),
      visual: { kind: "reverb", size: "Short plate, tucked", preDelayMs: d.preDelayMs },
      copy: ["Optional micro-space on the bus — most depth should already live on tracks/sends"],
      why: "Extra bus verb is easy to overdo on a finished-sounding master.",
      how: "If the mix gets farther away, pull the send to zero.",
    }),
  ];

  const signalFlow = inserts.map((s) => s.type).filter((x, i, a) => a.indexOf(x) === i);
  const sendFlow = [...new Set(sends.map((s) => s.type))];

  return {
    daw: "universal",
    target: "full",
    honesty:
      "Full-mix bus recreation from the finished master — a translation checklist, not the original mix session.",
    estimateNote:
      "Dialed from the full mix. Use Deep → Master for streaming loudness and delivery checks.",
    dial: d,
    signalFlow,
    sendFlow,
    orderWhy: [
      `Insert order: ${signalFlow.join(" → ")}`,
      "Corrective EQ → glue → image → limit. Brightening last is how bus chains fall apart.",
    ],
    inserts,
    sends,
    paidUpgrades: [
      { when: "Need a full mastering suite", plugin: "iZotope Ozone / FabFilter mastering bundle" },
    ],
  };
}
