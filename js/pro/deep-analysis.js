/**
 * Pro / Deep analysis: engineer-grade notes, sound design, ambient FX, master bus.
 */

import { affiliatesForRole } from "./affiliates.js";

/**
 * Extra vocal traits for Deep mode.
 */
export function deepenTraits(readout, traits) {
  const crest = readout.dynamics.crestDb;
  const lufs = readout.loudness?.lufsProxy ?? readout.dynamics.rmsDb;
  const ti = readout.transientIndex ?? 0;
  const corr = readout.stereo.correlation;
  const side = readout.stereo.sideMidRatio;
  const air = traits.tone.air;
  const mud = traits.tone.mud;
  const sib = traits.tone.sibilance;

  const denseness =
    crest < 7 ? "radio_dense" : crest < 11 ? "controlled" : "open_mix";
  const delivery =
    lufs > -10 ? "hot_stream" : lufs > -14 ? "streaming_loud" : lufs > -18 ? "competitive" : "dynamic";
  const attackFeel = ti > 6 ? "bright_transients" : ti < 0 ? "soft_attack" : "balanced_attack";
  const monoCompat = corr > 0.85 ? "mono_safe" : corr < 0.45 ? "wide_risk" : "stereo_ok";

  // Sound-design lane from space + tone + tempo feel
  const bpm = readout.tempo?.reliable ? readout.tempo.bpm : null;
  const feel = readout.tempo?.reliable ? readout.tempo.feel : null;
  let designLane = "polished_lead";
  if (side > 0.28 && air === "elevated") designLane = "atmospheric";
  else if (crest < 7 && sib === "elevated") designLane = "aggressive_pop";
  else if (side < 0.1 && air === "recessed") designLane = "intimate";
  else if ((feel === "ballad" || (bpm && bpm < 88)) && side < 0.18) designLane = "intimate";
  else if (feel === "fast" || (bpm && bpm > 140)) designLane = "aggressive_pop";
  else if (side > 0.22) designLane = "wide_fx";

  const spaceCharacter =
    side > 0.3 ? "wet_wide" : side > 0.15 ? "supported" : "dry_forward";

  const summary = [...traits.summary];
  if (denseness === "radio_dense") {
    summary.push("Full-mix crest is smashy — expect serial compression + light limiting on the vocal.");
  }
  if (delivery === "hot_stream" || delivery === "streaming_loud") {
    summary.push("Loudness proxy sits near/above typical streaming targets — don’t chase louder on the vocal alone.");
  }
  if (attackFeel === "bright_transients") {
    summary.push("Transient top is forward — watch de-ess and FET attack so S/T don’t spit.");
  }
  if (monoCompat === "wide_risk") {
    summary.push("Wide side energy — keep the lead centered; put width on doubles / FX returns.");
  }
  if (designLane === "atmospheric") {
    summary.push("Deep read: atmospheric lane — shimmer / ambient sends likely carry the record’s mood.");
  } else if (designLane === "aggressive_pop") {
    summary.push("Deep read: aggressive pop lane — designed grit + tight FX throws fit this pocket.");
  } else if (designLane === "intimate") {
    summary.push("Deep read: intimate lane — short space, almost dry lead, micro-moves only.");
  } else if (designLane === "wide_fx") {
    summary.push("Deep read: FX-wide lane — doubles, microshift, and send width do the stereo work.");
  }
  if (mud === "elevated") {
    summary.push("Deep: low-mid weight suggests a parallel ‘body’ bus or multiband tame before additive air.");
  }
  if (readout.tempo?.bpm && readout.tempo.reliable) {
    summary.push(`Deep tempo sync: ~${readout.tempo.bpm} BPM for throws / granular lengths.`);
  }
  if (readout.pitch?.keyLabel && readout.pitch.keyReliable) {
    summary.push(`Deep pitch lane: scale center ≈ ${readout.pitch.keyLabel}.`);
  }

  return {
    ...traits,
    deep: {
      denseness,
      delivery,
      attackFeel,
      monoCompat,
      designLane,
      spaceCharacter,
      lufsProxy: lufs,
      transientIndex: ti,
      sideMidRatio: side,
      bpm: readout.tempo?.reliable ? readout.tempo.bpm ?? null : null,
      keyLabel: readout.pitch?.keyReliable ? readout.pitch.keyLabel ?? null : null,
      register: readout.pitch?.register ?? null,
    },
    summary,
  };
}

/**
 * Master-bus analysis + suggested mastering chain (Pro).
 */
export function buildMasterAnalysis(readout, traits) {
  const m = readout.master || {};
  const crest = m.crestDb ?? readout.dynamics.crestDb;
  const lufs = m.lufsProxy ?? readout.loudness?.lufsProxy;
  const side = m.sideMidRatio ?? readout.stereo.sideMidRatio;
  const corr = m.correlation ?? readout.stereo.correlation;

  const glueDb = crest < 8 ? 1.5 : crest < 12 ? 1 : 0.5;
  const limitCatch = crest < 7 ? 2.5 : 1.5;
  const lowShelf =
    (m.bands || readout.bandsFullMix || []).find((b) => b.id === "bass" || b.label === "Bass");
  const airBand =
    (m.bands || []).find((b) => b.id === "air" || b.label === "Air");

  const notes = [];
  notes.push(
    Number.isFinite(lufs)
      ? `Loudness proxy ≈ ${lufs.toFixed(1)} (ballpark). Verify with Youlean / Insight before delivery.`
      : "Run a real LUFS meter before you print."
  );
  notes.push(
    crest < 8
      ? "Master crest is low — glue gently (1–2 dB) and don’t stack another aggressive limiter."
      : "There’s headroom in crest — you can add tasteful glue without crushing the mix."
  );
  if (side > 0.3) {
    notes.push("Side energy is high — narrow below ~120 Hz on the master imager; open width above 5 kHz only.");
  }
  if (corr < 0.5) {
    notes.push("Correlation is loose — check mono compatibility on the chorus.");
  }
  if (traits.deep?.designLane === "atmospheric") {
    notes.push("Atmospheric refs often print wetter — don’t over-limit or you’ll squash the ambient bloom.");
  }

  if (readout.tempo?.bpm && readout.tempo.reliable) {
    notes.push(`Tempo estimate ≈ ${readout.tempo.bpm} BPM — useful for delay throws on the master bus FX.`);
  }
  if (readout.pitch?.keyLabel && readout.pitch.keyReliable) {
    notes.push(`Tonal center ≈ ${readout.pitch.keyLabel} — keep master EQ musical around that key.`);
  }

  const steps = [
    {
      role: "master_eq",
      type: "EQ",
      title: "Corrective master EQ",
      plugin: "Linear-phase EQ",
      copy: [
        "HPF ~20–30 Hz (steep) to clear infrasonics",
        lowShelf && lowShelf.dbRelTotal > -8
          ? "Check 80–120 Hz for boom; cut 0.5–1.5 dB if needed"
          : "Low end looks controlled — tiny tonal moves only",
        airBand && airBand.dbRelTotal > -12
          ? "Air already up — avoid stacking brightness"
          : "Optional +0.5–1 dB shelf ~10 kHz if the mix feels dull",
      ],
      why: "Mastering EQ is subtractive first. Pros fix problems before glue and limiting.",
      affiliates: affiliatesForRole("master_eq"),
    },
    {
      role: "master_glue",
      type: "Compression",
      title: "Bus glue",
      plugin: "SSL-style bus compressor",
      copy: [
        `Ratio 2:1 · Attack ~30 ms · Auto release`,
        `Aim ${glueDb}–${glueDb + 0.5} dB gain reduction on peaks`,
        "Mix 40–70% if the plugin has a dry/wet",
      ],
      why: "1–2 dB of SSL-style glue is what makes a mix feel finished without sounding limited.",
      affiliates: affiliatesForRole("master_glue"),
    },
    {
      role: "master_image",
      type: "Imaging",
      title: "Stereo image polish",
      plugin: "Multiband imager",
      copy: [
        side > 0.25
          ? "Narrow 20–120 Hz toward mono · ease excess side in the mids"
          : "Keep lows mono · optional +width above ~5 kHz",
        "Check in mono after every width move",
      ],
      why: "Finished records manage width by band — not a single widener on the stereo bus.",
      affiliates: affiliatesForRole("master_image"),
    },
    {
      role: "master_limit",
      type: "Limiter",
      title: "True-peak limiter",
      plugin: "Transparent brickwall",
      copy: [
        `Catch ~${limitCatch} dB · Ceiling −1.0 dBTP`,
        "Transparent / Allround algorithm",
        "Match loudness to reference — don’t win a loudness war",
      ],
      why: "Pro-L / Ozone Maximizer last. Meter after the limiter, never before.",
      affiliates: affiliatesForRole("master_limit"),
    },
    {
      role: "master_meter",
      type: "Metering",
      title: "Delivery check",
      plugin: "LUFS + true peak",
      copy: [
        "Integrated ≈ −14 LUFS (most DSP) or label spec",
        "True peak ≤ −1.0 dBTP",
        "A/B vs reference at matched loudness",
      ],
      why: "The master isn’t done until translation and loudness targets are verified.",
      affiliates: affiliatesForRole("master_meter"),
    },
  ];

  return {
    honesty:
      "Master analysis is inferred from the finished file — not a stem-level master session. Use it as a translation checklist.",
    streamingTarget: m.streamingTarget,
    readouts: {
      peakDb: m.peakDb,
      rmsDb: m.rmsDb,
      crestDb: crest,
      lufsProxy: lufs,
      correlation: corr,
      sideMidRatio: side,
      centroidHz: m.centroidHz,
      bpm: m.bpm ?? (readout.tempo?.reliable ? readout.tempo?.bpm : null) ?? null,
      keyLabel: m.keyLabel ?? (readout.pitch?.keyReliable ? readout.pitch?.keyLabel : null) ?? null,
    },
    notes,
    steps,
    bands: m.bands || readout.bandsFullMix || [],
  };
}

/**
 * Attach affiliate picks onto chain steps (Deep / Pro).
 */
export function attachAffiliates(chain) {
  if (!chain) return chain;
  const mapStep = (s) => ({
    ...s,
    affiliates: s.affiliates || affiliatesForRole(s.role),
  });
  return {
    ...chain,
    inserts: (chain.inserts || []).map(mapStep),
    sends: (chain.sends || []).map(mapStep),
  };
}

/**
 * Extra Deep insert stages — resonance, multiband, pitch, microshift.
 */
export function deepVocalExtras(readout, traits) {
  const harsh = traits.tone.harshness === "elevated";
  const sib = traits.tone.sibilance === "elevated";
  const mud = traits.tone.mud === "elevated";
  const lane = traits.deep?.designLane || "polished_lead";
  const extras = [];

  extras.push({
    role: "resonance",
    type: "Resonance",
    title: "Resonance control",
    plugin: "Dynamic resonance suppressor",
    tier: "pro",
    dials: [
      { label: "Focus", value: harsh ? "2.5–5 kHz + 6–9 kHz" : "6–9 kHz (S region)" },
      { label: "Depth", value: harsh || sib ? "Medium" : "Light" },
      { label: "Rule", value: "Only when it spikes — not a static EQ" },
    ],
    visual: {
      kind: "eq",
      bands: [
        { id: "res", type: "bell", freq: harsh ? 3500 : 7000, gain: -2, q: 4, label: "Dynamic" },
      ],
    },
    copy: [
      harsh || sib
        ? "Park after de-ess — catch remaining whistles / harsh peaks"
        : "Light touch after de-ess if a note rings",
      "Depth medium at most — over-smoothing kills air",
    ],
    why: "soothe2-style resonance control is ubiquitous on modern pop/R&B vocals.",
    how: "Solo the delta. If the vocal gets dull, pull depth back.",
    affiliates: affiliatesForRole("resonance"),
  });

  extras.push({
    role: "multiband",
    type: "Multiband",
    title: "Multiband polish",
    plugin: "Dynamic EQ / multiband",
    tier: "pro",
    dials: [
      {
        label: "Low-mid",
        value: mud ? "200–400 Hz · gentle dynamic cut on loud notes" : "Light touch or bypass",
      },
      {
        label: "Presence",
        value: harsh ? "2.5–4 kHz · soft ceiling" : "Only if a syllable spikes",
      },
      { label: "Mix", value: "50–80% if the plugin has dry/wet" },
    ],
    visual: {
      kind: "eq",
      bands: [
        { id: "mb1", type: "bell", freq: 280, gain: mud ? -1.5 : -0.5, q: 1.2, label: "Body" },
        { id: "mb2", type: "bell", freq: 3200, gain: harsh ? -1.2 : -0.4, q: 1.4, label: "Bite" },
      ],
    },
    copy: [
      mud ? "Dynamic cut 200–400 Hz on the loudest phrases" : "Skip heavy low-mid work — already balanced",
      harsh ? "Soft dynamic ceiling ~3 kHz" : "Leave presence alone unless one note sticks out",
    ],
    why: "Top engineers use multiband / dynamic EQ for note-level balance without flattening the performance.",
    how: "If it pumps, raise thresholds. This stage should disappear into the vocal.",
    affiliates: affiliatesForRole("multiband"),
  });

  const keyLabel = (readout.pitch?.keyReliable && readout.pitch?.keyLabel) || (traits.deep?.keyLabel);
  const f0 = readout.pitch?.f0Reliable ? readout.pitch?.f0Hz : null;
  extras.push({
    role: "pitch",
    type: "Pitch",
    title: "Pitch & formant",
    plugin: "Pitch correction + formant",
    tier: "pro",
    dials: [
      {
        label: "Scale",
        value: keyLabel
          ? `${keyLabel}${f0 ? ` · lead ~${Math.round(f0)} Hz` : ""}`
          : "Set key in your tuner to match the song",
      },
      {
        label: "Mode",
        value:
          lane === "aggressive_pop"
            ? "Faster retune · modern pop edge"
            : "Transparent correction · keep vibrato",
      },
      {
        label: "Formant",
        value: lane === "atmospheric" || lane === "wide_fx" ? "Optional ± subtle design shift" : "Natural / bypass",
      },
      { label: "Rule", value: "Fix pitch before heavy saturation so harmonics track cleanly" },
    ],
    visual: {
      kind: "eq",
      bands: [{ id: "p", type: "bell", freq: f0 || 1000, gain: 0, q: 0.7, label: "Center" }],
    },
    copy: [
      keyLabel ? `Lock correction scale to ${keyLabel}` : "Set the song key before hard correction",
      lane === "aggressive_pop"
        ? "Harder retune speed if the ref has that contemporary snap"
        : "Keep correction musical — don’t erase vibrato",
      "Formant tools only if the ref clearly shifts character",
    ],
    why: keyLabel
      ? `Measured tonal center ≈ ${keyLabel} — use it for correction scale / harmony stacks.`
      : "Deep chains include pitch lane decisions — stock ‘correction’ vs designed Auto-Tune / formant moves.",
    how: "A/B the dry take. If it sounds like a plugin, slow the retune.",
    affiliates: affiliatesForRole("pitch"),
  });

  if (lane === "wide_fx" || lane === "atmospheric" || traits.deep?.spaceCharacter === "wet_wide") {
    extras.push({
      role: "microshift",
      type: "Width",
      title: "Microshift / thicken",
      plugin: "Micro pitch thickener",
      tier: "pro",
      dials: [
        { label: "Amount", value: "Subtle · 10–25%" },
        { label: "Focus", value: "Highs more than lows" },
        { label: "Mono", value: "Check — lead must survive fold-down" },
      ],
      visual: { kind: "width", mode: "fx_wide" },
      copy: [
        "Parallel microshift or very light stereo thicken",
        "Never replace a centered dry lead with a widened mono clip",
      ],
      why: "Wide modern vocals often use MicroShift-style offsets — not a single stereo widener on the lead.",
      how: "If the center collapses in mono, pull the amount in half.",
      affiliates: affiliatesForRole("microshift"),
    });
  }

  return extras;
}

/**
 * Extra Deep send / atmosphere stages.
 */
export function deepSendExtras(readout, traits) {
  const lane = traits.deep?.designLane || "polished_lead";
  const space = traits.deep?.spaceCharacter || "supported";
  const sends = [];

  sends.push({
    role: "ambient",
    type: "Ambient",
    title: "Ambient / shimmer send",
    plugin: "Shimmer or infinite reverb",
    tier: "pro",
    dials: [
      {
        label: "Size",
        value: lane === "intimate" ? "Short bloom · low mix" : "Medium–large shimmer bed",
      },
      { label: "Pitch", value: "+12 semitone shimmer sparingly" },
      { label: "Filter", value: "HPF return hard · tuck under the lead" },
    ],
    visual: {
      kind: "reverb",
      size: lane === "intimate" ? "Short bloom" : "Shimmer bed",
      preDelayMs: 28,
    },
    copy: [
      lane === "atmospheric"
        ? "Lean into the wash — this ref lives in atmosphere"
        : lane === "intimate"
          ? "Almost none — a hint of bloom max"
          : "Supportive shimmer behind phrase ends",
      "Always on a send — never 100% wet on the lead",
    ],
    why: "Deep ambient tools (Shimmer, Blackhole, Supermassive) define modern vocal space beyond stock plates.",
    how: "Ride the send. Constant wash = mud. Phrase-end bloom = production.",
    affiliates: affiliatesForRole("ambient"),
  });

  if (lane === "atmospheric" || lane === "wide_fx" || lane === "aggressive_pop") {
    sends.push({
      role: "granular",
      type: "Design",
      title: "Granular / transition FX",
      plugin: "Granular / reverse FX",
      tier: "pro",
      dials: [
        { label: "Use", value: "Post-chorus throws · risers · one-shots" },
        { label: "Mix", value: "Automation only — not always-on" },
        { label: "Tone", value: "Darken the return so it doesn’t fight S’s" },
      ],
      visual: {
        kind: "delay",
        time: "1/4–1/2 throw",
        feedbackPct: 18,
        lowpassHz: 3500,
      },
      copy: [
        "Portal / Crystallizer-style grains for transitions",
        "Print throws to audio and edit — don’t leave live chaos",
      ],
      why: "Sound design VSTs create the ‘record moments’ stock delays can’t — risers, reverse tails, granular sprays.",
      how: "If you notice it every bar, it’s too loud or too constant.",
      affiliates: affiliatesForRole("granular"),
    });
  } else if (lane !== "intimate") {
    sends.push({
      role: "granular",
      type: "Design",
      title: "Transition FX (light)",
      plugin: "Granular / reverse FX",
      tier: "pro",
      dials: [
        { label: "Use", value: "1–2 printed throws per song max" },
        { label: "Mix", value: "Background · not a hook" },
        { label: "Tone", value: "Dark return · HPF hard" },
      ],
      visual: {
        kind: "delay",
        time: "1/2 throw",
        feedbackPct: 12,
        lowpassHz: 3000,
      },
      copy: [
        "Even polished leads get one designed moment — reverse into a chorus, short grain spray",
        "Print to audio; don’t leave Portal live on the session",
      ],
      why: "Deep mode always considers production FX — not only stock delay/reverb.",
      how: "If it draws attention away from the lyric, pull it 3–6 dB or delete it.",
      affiliates: affiliatesForRole("granular"),
    });
  }

  if (lane !== "intimate" && (lane === "atmospheric" || space === "wet_wide" || lane === "polished_lead")) {
    sends.push({
      role: "ambient_bed",
      type: "Ambient",
      title: "Ambient pad / bed",
      plugin: "Shimmer bed or ambient pad return",
      tier: "pro",
      dials: [
        {
          label: "Level",
          value: lane === "atmospheric" ? "Audible bed under hooks" : "Felt, not heard · −18 to −24 dB under lead",
        },
        { label: "Filter", value: "HPF ~250 Hz · LPF ~7 kHz" },
        { label: "Ride", value: "Automate in choruses · mute dry verses" },
      ],
      visual: {
        kind: "reverb",
        size: "Pad bed",
        preDelayMs: 40,
      },
      copy: [
        "Separate return from the short plate — this is atmosphere, not glue",
        "Optional soft pad under the shimmer if the ref feels ‘cinematic’",
      ],
      why: "Ambient beds and pad-like returns are how Deep recreates modern vocal atmosphere beyond a single reverb send.",
      how: "Solo the bed against the lead. If lyrics blur, darken or duck it.",
      affiliates: affiliatesForRole("ambient_bed"),
    });
  }

  if (lane === "aggressive_pop" || traits.tone.harshness === "elevated") {
    sends.push({
      role: "texture",
      type: "Texture",
      title: "Dirt / texture parallel",
      plugin: "Creative distortion / lo-fi",
      tier: "pro",
      dials: [
        { label: "Drive", value: "Parallel · 10–30% blend" },
        { label: "Band", value: "Focus mid drive — keep sub clean" },
        { label: "Noise", value: "Optional tape/noise bed under verses" },
      ],
      visual: {
        kind: "saturator",
        drive: "Parallel low",
        character: "grit",
      },
      copy: [
        "Parallel Trash / RC-20 / Decapitator for edge",
        "HPF the dirt return — don’t thicken the mud",
      ],
      why: "Aggressive refs often hide a parallel dirt lane under the clean lead.",
      how: "Mute it often. Character should feel like attitude, not a broken speaker.",
      affiliates: affiliatesForRole("texture"),
    });
  }

  if (lane === "atmospheric" || space === "wet_wide") {
    sends.push({
      role: "vocal_design",
      type: "Design",
      title: "Vocal design layer",
      plugin: "VocalSynth / formant FX",
      tier: "pro",
      dials: [
        { label: "Layer", value: "Quiet octaves / talkbox / choir under hooks" },
        { label: "Level", value: "Felt more than heard" },
        { label: "Sidechain", value: "Duck under lead consonants" },
      ],
      visual: { kind: "modulation", depth: "subtle", rate: "slow" },
      copy: [
        "Design layer on a separate track — not inserts on the lead",
        "Mute in verses if the ref goes dry",
      ],
      why: "Contemporary records stack designed vocal layers; Deep calls that out as production, not ‘more reverb.’",
      how: "If lyrics get masked, cut the layer’s highs or automate it out of the pocket.",
      affiliates: affiliatesForRole("vocal_design"),
    });
  }

  return sends;
}

/**
 * Deep sound-design brief for the Design tab.
 */
export function buildDesignBrief(readout, traits) {
  const lane = traits.deep?.designLane || "polished_lead";
  const space = traits.deep?.spaceCharacter || "supported";
  const delivery = traits.deep?.delivery || "competitive";

  const laneCopy = {
    polished_lead: "Clean contemporary lead — FX support the vocal; they don’t become the song.",
    atmospheric: "Atmosphere-forward — shimmer, long tails, and designed space are part of the hook.",
    aggressive_pop: "Aggressive pop/R&B edge — tighter FX, dirt parallel, sharper pitch character.",
    intimate: "Close and dry — micro space only; any wash should feel like a whisper.",
    wide_fx: "Width comes from doubles, microshift, and sends — keep the dry lead mono and solid.",
  };

  const layers = [
    {
      id: "space",
      title: "Space architecture",
      intent: laneCopy[lane] || laneCopy.polished_lead,
      moves: [
        space === "wet_wide"
          ? "Two-send system: short plate for body + ambient shimmer/Blackhole for bloom"
          : space === "dry_forward"
            ? "One short plate or room · pre-delay ~15–25 ms · low send"
            : "Plate for glue · delay throws on phrase ends · optional shimmer bed under hooks",
        "Filter every return hard — bright tails fight de-ess and air",
        "Pre-delay so consonants stay dry; wash arrives after the lyric",
      ],
      tools: affiliatesForRole("ambient"),
    },
    {
      id: "ambient_bed",
      title: "Ambient bed & pads",
      intent:
        lane === "intimate"
          ? "Skip beds — intimacy dies when pads fill the pocket."
          : "A quiet atmospheric bed under hooks sells ‘record’ depth without drowning the lead.",
      moves: [
        lane === "intimate"
          ? "No pad bed — leave air around the voice"
          : "Dedicated ambient return (Shimmer / Supermassive / Blackhole) under choruses only",
        "HPF ~200–300 Hz on the bed · LPF ~6–8 kHz so S’s stay clean",
        "Sidechain or automate the bed −3 to −6 dB under dense lines",
      ],
      tools: affiliatesForRole("ambient_bed"),
    },
    {
      id: "design",
      title: "Sound design & transitions",
      intent:
        lane === "intimate"
          ? "Almost no design moments — silence is the effect."
          : "Granular / reverse / Portal-style one-shots mark section changes like a finished record.",
      moves: [
        lane === "intimate"
          ? "Skip always-on design layers"
          : "Automate throws into choruses, bridges, and outros only",
        "Print FX to audio and arrange — treat design like production, not a live preset",
        "Reverse reverb into downbeats · short granular sprays after hooks",
      ],
      tools: affiliatesForRole("granular"),
    },
    {
      id: "character",
      title: "Vocal character",
      intent:
        lane === "aggressive_pop"
          ? "Allow a harder pitch lane + parallel grit."
          : lane === "atmospheric"
            ? "Optional formant / VocalSynth bed under hooks."
            : "Transparent pitch · natural formant — character comes from saturation and doubles.",
      moves: [
        "Decide pitch personality before saturation so harmonics match",
        traits.tone.air === "elevated"
          ? "Air is already up — Fresh Air / Maag only if the lead still feels veiled"
          : "Gentle air tool after de-ess if presence needs lift",
        lane === "aggressive_pop"
          ? "Parallel dirt (Trash / RC-20) at 10–25% under the clean lead"
          : "Keep grit optional — mute often",
      ],
      tools: [
        ...affiliatesForRole("pitch").slice(0, 2),
        ...affiliatesForRole(lane === "aggressive_pop" ? "texture" : "formant").slice(0, 2),
      ],
    },
    {
      id: "layers",
      title: "Designed vocal layers",
      intent:
        lane === "atmospheric" || space === "wet_wide"
          ? "Stack quiet octaves, choir, or talkbox under hooks — felt more than heard."
          : "Doubles and ad-libs first; synth-vocal layers only if the ref clearly uses them.",
      moves: [
        "Separate track for design layers — never insert VocalSynth on the dry lead",
        "Duck under lead consonants; mute in dry verses",
        "Match formant / pitch personality to the lead lane",
      ],
      tools: affiliatesForRole("vocal_design"),
    },
    {
      id: "width",
      title: "Stereo & doubles",
      intent: "Lead stays centered. Width is arrangement + FX returns.",
      moves: [
        traits.deep?.monoCompat === "wide_risk"
          ? "Priority: mono-check every widen move"
          : "Real or stacked doubles panned L/R under the hook",
        "MicroShift-style thicken at low mix if doubles aren’t available",
        "Keep sub / body mono; open width above ~2–3 kHz on returns",
      ],
      tools: affiliatesForRole("microshift"),
    },
    {
      id: "delivery",
      title: "Loudness & print discipline",
      intent: `Delivery pocket reads ${delivery.replace(/_/g, " ")} — don’t chase loudness on the vocal alone.`,
      moves: [
        "A/B wet vs dry against the reference at matched loudness",
        "Print FX returns before the master limiter so bloom isn’t crushed",
        "Leave true-peak headroom for the master pass (Design → Master tab)",
      ],
      tools: affiliatesForRole("master_meter"),
    },
  ];

  return {
    lane,
    space,
    headline: `Deep lane · ${lane.replace(/_/g, " ")}`,
    blurb: laneCopy[lane],
    layers,
    checklist: [
      "Dry lead centered and mono-safe",
      "FX on filtered sends — never 100% wet on the lead",
      "Ambient bed automated under hooks, not always-on",
      "Design moments (granular / reverse) printed and arranged",
      "Vocal design layers ducked under consonants",
      "A/B wet and dry against the reference at matched loudness",
      "Master image checked after vocal FX are printed",
    ],
  };
}
