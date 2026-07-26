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

  const findings = [...(traits.findings || [])];
  const pushFinding = (label, text) => {
    findings.push({ label, text });
  };

  if (denseness === "radio_dense") {
    pushFinding(
      "Density",
      "The full mix is very smashed. Use two light compressors on the vocal, then a light limiter — not one heavy smash."
    );
  }
  if (delivery === "hot_stream" || delivery === "streaming_loud") {
    pushFinding(
      "Loudness",
      "Already near streaming loudness. Don’t try to make the vocal louder on its own."
    );
  }
  if (attackFeel === "bright_transients") {
    pushFinding(
      "Transients",
      "Bright attacks up top. Ease FET attack and de-ess so S/T don’t spit."
    );
  }
  if (monoCompat === "wide_risk") {
    pushFinding(
      "Width",
      "Wide sides. Keep the lead mono-centered; put width on doubles and FX returns."
    );
  }
  if (designLane === "atmospheric") {
    pushFinding("Vibe", "Atmospheric record — ambient/shimmer sends carry a lot of the mood.");
  } else if (designLane === "aggressive_pop") {
    pushFinding("Vibe", "Aggressive pop pocket — grit and tight FX throws fit this reference.");
  } else if (designLane === "intimate") {
    pushFinding("Vibe", "Intimate / dry lead — short space only, small moves.");
  } else if (designLane === "wide_fx") {
    pushFinding("Vibe", "FX-wide production — doubles and send width do the stereo work.");
  }
  if (mud === "elevated") {
    pushFinding(
      "Body",
      "Heavy low-mids. Tame body (EQ or multiband) before adding air on top."
    );
  }
  if (readout.tempo?.bpm && readout.tempo.reliable) {
    pushFinding("Tempo sync", `~${readout.tempo.bpm} BPM — use for delay and throw lengths.`);
  }
  if (readout.pitch?.keyLabel && readout.pitch.keyReliable) {
    pushFinding(
      "Scale",
      `Center around ${readout.pitch.keyLabel}${
        readout.pitch.relativeKey ? ` (relative ${readout.pitch.relativeKey})` : ""
      }.`
    );
  }

  const summary = findings.map((f) => f.text);

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
    findings,
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
    notes.push(
      `Tonal center ≈ ${readout.pitch.keyLabel}${
        readout.pitch.relativeKey ? ` · relative ${readout.pitch.relativeKey}` : ""
      } — keep master EQ musical around that key.`
    );
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
  const relativeKey = readout.pitch?.relativeKey || null;
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
          ? `${keyLabel}${relativeKey ? ` · rel ${relativeKey}` : ""}${f0 ? ` · lead ~${Math.round(f0)} Hz` : ""}`
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
      ? `Measured tonal center ≈ ${keyLabel}${relativeKey ? ` (rel. ${relativeKey})` : ""} — use it for correction scale / harmony stacks.`
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
 * Plain-language production plan — not a plugin dump.
 */
export function buildDesignBrief(readout, traits, target = "vocal") {
  const resolved = target === "instrumental" || target === "full" ? target : "vocal";
  if (resolved === "instrumental") return buildInstrumentalDesignBrief(readout, traits);
  if (resolved === "full") return buildFullMixDesignBrief(readout, traits);
  return buildVocalDesignBrief(readout, traits);
}

function buildVocalDesignBrief(readout, traits) {
  const lane = traits?.deep?.designLane || "polished_lead";
  const space = traits?.deep?.spaceCharacter || "supported";
  const delivery = traits?.deep?.delivery || "competitive";

  const laneMeta = {
    polished_lead: {
      title: "Clean contemporary lead",
      blurb: "FX support the vocal — they shouldn’t become the song. Keep the dry lead clear and centered.",
    },
    atmospheric: {
      title: "Atmosphere-first vocal",
      blurb: "Long tails, shimmer, and designed space are part of the hook. Build depth with sends, not by soaking the dry lead.",
    },
    aggressive_pop: {
      title: "Aggressive pop edge",
      blurb: "Tighter FX, optional grit, and sharper pitch character. Keep energy high without washing out the lyric.",
    },
    intimate: {
      title: "Close and dry",
      blurb: "Almost no wash. Micro space only — silence and proximity are the effect.",
    },
    wide_fx: {
      title: "Width from arrangement",
      blurb: "Doubles, microshift, and FX returns create the stereo image. Keep the dry lead mono and solid in the center.",
    },
  };

  const spaceCue = {
    wet_wide: "Wide, wet space — use two sends (short body + long bloom).",
    dry_forward: "Dry and forward — one short plate/room at a low send.",
    supported: "Natural support — plate for glue, throws on phrase ends.",
  };

  const meta = laneMeta[lane] || laneMeta.polished_lead;

  const spaceGoal =
    space === "wet_wide"
      ? "Depth is part of the hook — build it on sends so the dry lead stays intelligible."
      : space === "dry_forward"
        ? "Keep space short and quiet so the lyric stays right up front."
        : "Space should glue the vocal without becoming a wash.";

  const tone = traits?.tone || {};
  const layers = [
    {
      id: "space",
      title: "Reverb & delay",
      goal: spaceGoal,
      actions: [
        space === "wet_wide"
          ? "Use two sends: a short plate for body, plus a longer ambient/shimmer send for bloom."
          : space === "dry_forward"
            ? "One short plate or room only. Pre-delay about 15–25 ms. Keep the send low."
            : "Plate for glue. Add delay throws on phrase ends. Optional shimmer under hooks only.",
        "Filter every return — bright tails fight de-ess and air.",
        "Set pre-delay so consonants stay dry; the wash arrives after the lyric.",
      ],
      tools: affiliatesForRole("ambient"),
    },
    {
      id: "ambient_bed",
      title: "Ambient bed",
      goal:
        lane === "intimate"
          ? "Skip pads. Intimacy dies when beds fill the pocket."
          : "A quiet bed under hooks adds record depth without drowning the lead.",
      actions: [
        lane === "intimate"
          ? "No pad bed — leave air around the voice."
          : "Add a dedicated ambient return under choruses only (not always on).",
        "High-pass the bed around 200–300 Hz and low-pass around 6–8 kHz so S sounds stay clean.",
        "Automate or sidechain the bed down 3–6 dB under dense lines.",
      ],
      tools: affiliatesForRole("ambient_bed"),
    },
    {
      id: "design",
      title: "Section moments",
      goal:
        lane === "intimate"
          ? "Almost no design moments — silence is the effect."
          : "Short design hits (reverse, granular, throws) mark section changes like a finished record.",
      actions: [
        lane === "intimate"
          ? "Skip always-on design layers."
          : "Automate throws into choruses, bridges, and outros only.",
        "Print FX to audio and arrange them — treat design like production, not a live preset.",
        "Try reverse reverb into downbeats and short sprays after hooks.",
      ],
      tools: affiliatesForRole("granular"),
    },
    {
      id: "character",
      title: "Vocal character",
      goal:
        lane === "aggressive_pop"
          ? "Harder pitch + a little parallel grit is fair game."
          : lane === "atmospheric"
            ? "Optional formant / synth-vocal color under hooks."
            : "Keep pitch natural. Character comes from saturation and doubles, not heavy effects.",
      actions: [
        "Decide pitch personality before saturation so harmonics match.",
        tone.air === "elevated"
          ? "Air is already bright — only add more top if the lead still feels veiled."
          : "After de-ess, a gentle air lift is fine if presence needs help.",
        lane === "aggressive_pop"
          ? "Parallel dirt at about 10–25% under the clean lead."
          : "Keep grit optional — mute it often.",
      ],
      tools: [
        ...affiliatesForRole("pitch").slice(0, 2),
        ...affiliatesForRole(lane === "aggressive_pop" ? "texture" : "formant").slice(0, 2),
      ],
    },
    {
      id: "layers",
      title: "Extra vocal layers",
      goal:
        lane === "atmospheric" || space === "wet_wide"
          ? "Quiet octaves, choir, or talkbox under hooks — felt more than heard."
          : "Doubles and ad-libs first. Synth-vocal layers only if the reference clearly uses them.",
      actions: [
        "Put design layers on a separate track — never insert them on the dry lead.",
        "Duck under lead consonants; mute them in dry verses.",
        "Match pitch/formant personality to the lead.",
      ],
      tools: affiliatesForRole("vocal_design"),
    },
    {
      id: "width",
      title: "Stereo width",
      goal: "Lead stays centered. Width comes from doubles and FX returns — not a widener on the dry vocal.",
      actions: [
        traits.deep?.monoCompat === "wide_risk"
          ? "Priority: mono-check every widen move."
          : "Stack doubles panned left/right under the hook.",
        "If you don’t have doubles, a light microshift thicken is enough.",
        "Keep low end mono. Open width above about 2–3 kHz on returns only.",
      ],
      tools: affiliatesForRole("microshift"),
    },
    {
      id: "delivery",
      title: "Print & loudness",
      goal: `This mix already sits in a ${delivery.replace(/_/g, " ")} loudness pocket — don’t chase volume on the vocal alone.`,
      actions: [
        "A/B wet vs dry against the reference at matched loudness.",
        "Print FX returns before the master limiter so bloom isn’t crushed.",
        "Leave true-peak headroom for the Master tab.",
      ],
      tools: affiliatesForRole("master_meter"),
    },
  ];

  return {
    lane,
    space,
    headline: meta.title,
    blurb: meta.blurb,
    cues: [
      { label: "Space", text: spaceCue[space] || spaceCue.supported },
      {
        label: "Loudness",
        text: `Reads ${delivery.replace(/_/g, " ")} — finish tone before chasing level.`,
      },
    ],
    layers,
    checklist: [
      "Dry lead is centered and still sounds good in mono",
      "FX are on filtered sends — not 100% wet on the lead",
      "Ambient bed only under hooks (or skipped for intimate mixes)",
      "Design moments are printed and arranged, not always running",
      "Extra vocal layers are ducked under consonants",
      "Wet and dry A/B’d against the reference at matched loudness",
      "Master image checked after vocal FX are printed",
    ],
  };
}

function buildInstrumentalDesignBrief(readout, traits) {
  const space = traits.deep?.spaceCharacter || "supported";
  const delivery = traits.deep?.delivery || "competitive";
  const denseness = traits.deep?.denseness || "controlled";
  const instruments = (readout.instruments || traits.instruments || [])
    .slice(0, 3)
    .map((i) => i.label)
    .filter(Boolean);

  return {
    lane: "instrumental_bed",
    space,
    headline: "Instrumental production plan",
    blurb:
      "Shape the bed like a finished record — low-end weight, glue, width, and section energy — without smearing the pocket.",
    cues: [
      {
        label: "Sources",
        text: instruments.length
          ? `Detected cues · ${instruments.join(" · ")} — verify by ear and build layers around them.`
          : "No strong source labels — trust your ear for drums, bass, and harmonic beds.",
      },
      {
        label: "Density",
        text: `Mix reads ${String(denseness).replace(/_/g, " ")} · loudness ${String(delivery).replace(/_/g, " ")}.`,
      },
    ],
    layers: [
      {
        id: "foundation",
        title: "Low-end foundation",
        goal: "Kick and bass own separate lanes so the bed stays punchy in mono.",
        actions: [
          "High-pass non-bass beds around 80–120 Hz so the sub stays clean.",
          "Sidechain or duck pads under kick/bass if the pocket feels cloudy.",
          denseness === "radio_dense"
            ? "Already dense — prefer subtractive EQ over more compression on the bed."
            : "Light bus glue after the arrangement feels solid.",
        ],
        tools: affiliatesForRole("eq"),
      },
      {
        id: "space",
        title: "Bed space",
        goal:
          space === "wet_wide"
            ? "Wide ambience is part of the record — keep it on returns."
            : "Short rooms and plates glue the bed without washing transients.",
        actions: [
          space === "wet_wide"
            ? "Two returns: short room for drums, longer ambient send for pads/guitars."
            : "One short room/plate on drums and harmonic beds; keep pre-delay audible.",
          "Filter returns so low end stays mono and dry.",
          "Automate space up into choruses; pull it back in verses.",
        ],
        tools: affiliatesForRole("ambient"),
      },
      {
        id: "width",
        title: "Stereo image",
        goal: "Center the power instruments; let pads, FX, and doubles carry width.",
        actions: [
          traits.deep?.monoCompat === "wide_risk"
            ? "Mono-check the whole bed — pull wideners off kick/bass/snare."
            : "Pan supporting layers; keep kick, snare, and bass centered.",
          "Add microshift or chorus only on pads/guitars, not the drum bus.",
          "Check phone/mono — if the hook disappears, you over-widened.",
        ],
        tools: affiliatesForRole("microshift"),
      },
      {
        id: "moments",
        title: "Section energy",
        goal: "Risers, filters, and mutes mark section changes like a finished instrumental.",
        actions: [
          "Automate filter opens / noise risers into hooks.",
          "Mute or thin beds for one bar before drops to create impact.",
          "Print FX hits to audio so arrangement edits stay intentional.",
        ],
        tools: affiliatesForRole("granular"),
      },
      {
        id: "delivery",
        title: "Print & glue",
        goal: `Aim for a ${String(delivery).replace(/_/g, " ")} print — tone before loudness.`,
        actions: [
          "A/B the bed against the reference at matched loudness.",
          "Print arrangement FX before the master limiter.",
          "Leave headroom for the Master tab.",
        ],
        tools: affiliatesForRole("master_meter"),
      },
    ],
    checklist: [
      "Kick/bass still clear in mono",
      "Pads and FX are filtered out of the sub",
      "Width is on supports, not the drum bus",
      "Section automation is printed or locked",
      "Bed A/B’d vs reference at matched loudness",
      "True-peak headroom left for Master",
    ],
  };
}

function buildFullMixDesignBrief(readout, traits) {
  const space = traits.deep?.spaceCharacter || "supported";
  const delivery = traits.deep?.delivery || "competitive";
  const denseness = traits.deep?.denseness || "controlled";

  return {
    lane: "full_mix",
    space,
    headline: "Full-mix production plan",
    blurb:
      "Treat the song as one picture — arrangement density, bus space, transitions, and print — then finish on Master.",
    cues: [
      {
        label: "Picture",
        text: `Density ${String(denseness).replace(/_/g, " ")} · space ${String(space).replace(/_/g, " ")}.`,
      },
      {
        label: "Loudness",
        text: `Reads ${String(delivery).replace(/_/g, " ")} — don’t crush detail to chase LUFS.`,
      },
    ],
    layers: [
      {
        id: "arrangement",
        title: "Arrangement density",
        goal: "Each section should feel intentional — thinner verses, denser hooks.",
        actions: [
          "Mute or filter layers in verses so hooks expand.",
          "Stack one extra bed or FX lane only under choruses.",
          denseness === "radio_dense"
            ? "Already smashed — create contrast with arrangement, not more bus compression."
            : "Add light bus glue after the arrangement reads clearly.",
        ],
        tools: affiliatesForRole("bus_comp"),
      },
      {
        id: "space",
        title: "Mix-bus space",
        goal: "Shared space glues the record without washing lead elements.",
        actions: [
          space === "wet_wide"
            ? "Keep long ambience on returns; keep lead vocal/drums drier than the wash."
            : "Short plate/room sends for glue; save long tails for transitions.",
          "High-pass and low-pass every return.",
          "Automate send levels by section.",
        ],
        tools: affiliatesForRole("ambient"),
      },
      {
        id: "transitions",
        title: "Transitions & moments",
        goal: "Fills, reverse FX, and filter sweeps sell section changes.",
        actions: [
          "Place risers/sweeps into choruses and bridges.",
          "Print transition FX to audio for tight edits.",
          "Leave one beat of air before big drops when the reference does.",
        ],
        tools: affiliatesForRole("granular"),
      },
      {
        id: "width",
        title: "Image & mono",
        goal: "Power stays centered; sides carry sparkle and FX.",
        actions: [
          traits.deep?.monoCompat === "wide_risk"
            ? "Collapse wideners on low/mid fundamentals until mono holds."
            : "Check mono compatibility after every stereo FX move.",
          "Keep vocal, kick, snare, and bass centered.",
          "Open side energy above ~2–3 kHz on pads/FX.",
        ],
        tools: affiliatesForRole("microshift"),
      },
      {
        id: "delivery",
        title: "Print path",
        goal: `Finish toward a ${String(delivery).replace(/_/g, " ")} master without killing transients.`,
        actions: [
          "A/B the full mix vs reference at matched loudness before limiting hard.",
          "Print creative FX before the mastering chain.",
          "Use the Master tab for crest, peak, and streaming targets.",
        ],
        tools: affiliatesForRole("master_meter"),
      },
    ],
    checklist: [
      "Verses and hooks feel different in density",
      "Returns are filtered; low end stays mono",
      "Transitions are intentional and printed",
      "Lead elements survive a mono check",
      "Full mix A/B’d vs reference at matched loudness",
      "Headroom left for Master limiting",
    ],
  };
}
