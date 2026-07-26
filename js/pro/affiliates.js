/**
 * Pro plugin recommendations + affiliate purchase links.
 * Swap AFFILIATE.aid / buildBuyUrl when real partner IDs land.
 */

export const AFFILIATE = {
  /** Partner / tracking id — replace when enrolled */
  aid: "chainprint",
  network: "pluginboutique",
};

/**
 * @param {string} query — product search string
 * @param {{ sku?: string }} [opts]
 */
export function buildBuyUrl(query, opts = {}) {
  const q = encodeURIComponent(query);
  const aid = encodeURIComponent(AFFILIATE.aid);
  // Plugin Boutique affiliate pattern (a_aid). Falls back to search until SKUs are mapped.
  if (opts.sku) {
    return `https://www.pluginboutique.com/product/${encodeURIComponent(opts.sku)}?a_aid=${aid}`;
  }
  return `https://www.pluginboutique.com/search?q=${q}&a_aid=${aid}`;
}

/**
 * Industry-standard tools used by top mix / mastering engineers
 * (FabFilter, Waves CLA, UAD, oeksound, Soundtoys, iZotope, etc.)
 */
export const PRO_CATALOG = {
  eq_surgical: {
    id: "eq_surgical",
    name: "FabFilter Pro-Q 4",
    brand: "FabFilter",
    role: "Surgical / dynamic EQ",
    why: "Dynamic bands + mid/side — the default corrective EQ on pro vocal and master buses.",
    search: "FabFilter Pro-Q 4",
  },
  eq_air: {
    id: "eq_air",
    name: "Maag EQ4",
    brand: "Plugin Alliance",
    role: "Air band",
    why: "The 40 kHz Air Band is a staple for presence without harshness on leads.",
    search: "Maag EQ4",
  },
  deess: {
    id: "deess",
    name: "FabFilter Pro-DS",
    brand: "FabFilter",
    role: "De-esser",
    why: "Single and wide-band modes with clear metering — standard when stock de-essors lisp.",
    search: "FabFilter Pro-DS",
  },
  soothe: {
    id: "soothe",
    name: "oeksound soothe2",
    brand: "oeksound",
    role: "Resonance control",
    why: "Used by top engineers (incl. Jaycen Joshua workflows) to tame harsh resonances dynamically.",
    search: "oeksound soothe2",
  },
  comp_fet: {
    id: "comp_fet",
    name: "Waves CLA-76",
    brand: "Waves",
    role: "FET compressor",
    why: "1176-style transient control — classic first stage on contemporary vocals.",
    search: "Waves CLA-76",
  },
  comp_opt: {
    id: "comp_opt",
    name: "Waves CLA-2A",
    brand: "Waves",
    role: "Optical compressor",
    why: "Musical leveling after an FET — the serial-comp backbone of many hit vocal chains.",
    search: "Waves CLA-2A",
  },
  comp_transparent: {
    id: "comp_transparent",
    name: "FabFilter Pro-C 2",
    brand: "FabFilter",
    role: "Transparent compressor",
    why: "Clean leveling with excellent metering when you don’t want color.",
    search: "FabFilter Pro-C 2",
  },
  sat: {
    id: "sat",
    name: "Soundtoys Decapitator",
    brand: "Soundtoys",
    role: "Saturation",
    why: "Go-to harmonic density on vocals without sounding like a guitar pedal.",
    search: "Soundtoys Decapitator",
  },
  sat_mb: {
    id: "sat_mb",
    name: "FabFilter Saturn 2",
    brand: "FabFilter",
    role: "Multiband saturation",
    why: "Warm mids/highs while keeping the low end clean — modern vocal polish.",
    search: "FabFilter Saturn 2",
  },
  delay: {
    id: "delay",
    name: "Soundtoys EchoBoy",
    brand: "Soundtoys",
    role: "Delay",
    why: "Industry-standard vocal delay with musical filters and slap modes.",
    search: "Soundtoys EchoBoy",
  },
  verb: {
    id: "verb",
    name: "Valhalla VintageVerb",
    brand: "Valhalla",
    role: "Reverb",
    why: "Plate / hall staples at a price every mix room can justify.",
    search: "Valhalla VintageVerb",
  },
  verb_pro: {
    id: "verb_pro",
    name: "FabFilter Pro-R 2",
    brand: "FabFilter",
    role: "Pro reverb",
    why: "Clean, tunable space when you need precise decay shaping on sends.",
    search: "FabFilter Pro-R 2",
  },
  master_eq: {
    id: "master_eq",
    name: "FabFilter Pro-Q 4",
    brand: "FabFilter",
    role: "Mastering EQ",
    why: "Linear-phase + M/S — default surgical tool on mastering chains.",
    search: "FabFilter Pro-Q 4",
  },
  master_glue: {
    id: "master_glue",
    name: "Cytomic The Glue",
    brand: "Cytomic",
    role: "Bus compressor",
    why: "SSL-style glue at 1–2 dB GR — classic mix/master bus cohesion.",
    search: "Cytomic The Glue",
  },
  master_suite: {
    id: "master_suite",
    name: "iZotope Ozone 12",
    brand: "iZotope",
    role: "Mastering suite",
    why: "All-in-one EQ, dynamics, imager, and maximizer used across pro and indie masters.",
    search: "iZotope Ozone 12",
  },
  master_limiter: {
    id: "master_limiter",
    name: "FabFilter Pro-L 2",
    brand: "FabFilter",
    role: "True-peak limiter",
    why: "Transparent brickwall limiting — streaming delivery standard.",
    search: "FabFilter Pro-L 2",
  },
  meter: {
    id: "meter",
    name: "Youlean Loudness Meter 2",
    brand: "Youlean",
    role: "Loudness metering",
    why: "Free LUFS / true-peak metering every engineer keeps on the master.",
    search: "Youlean Loudness Meter 2",
  },
  microshift: {
    id: "microshift",
    name: "Soundtoys MicroShift",
    brand: "Soundtoys",
    role: "Stereo thicken",
    why: "Subtle pitch/time offsets for width without a chorus wash — studio doubles in a box.",
    search: "Soundtoys MicroShift",
  },
  little_alterboy: {
    id: "little_alterboy",
    name: "Soundtoys Little AlterBoy",
    brand: "Soundtoys",
    role: "Formant / pitch",
    why: "Formant shifts and hard-tune character for modern vocal design lanes.",
    search: "Soundtoys Little AlterBoy",
  },
  vocal_synth: {
    id: "vocal_synth",
    name: "iZotope VocalSynth 2",
    brand: "iZotope",
    role: "Vocal sound design",
    why: "Talkbox, biovox, and polyvox layers when the ref has designed vocal textures.",
    search: "iZotope VocalSynth 2",
  },
  portal: {
    id: "portal",
    name: "Output Portal",
    brand: "Output",
    role: "Granular FX",
    why: "Granular stutters and rising textures for post-chorus throws and transitions.",
    search: "Output Portal",
  },
  crystallizer: {
    id: "crystallizer",
    name: "Eventide Crystallizer",
    brand: "Eventide",
    role: "Reverse granular",
    why: "Classic reverse crystalline tails behind contemporary vocals.",
    search: "Eventide Crystallizer",
  },
  blackhole: {
    id: "blackhole",
    name: "Eventide Blackhole",
    brand: "Eventide",
    role: "Ambient reverb",
    why: "Huge, otherworldly space when the mix wants atmosphere beyond a plate.",
    search: "Eventide Blackhole",
  },
  shimmer: {
    id: "shimmer",
    name: "Valhalla Shimmer",
    brand: "Valhalla",
    role: "Shimmer reverb",
    why: "Pitch-shifted ambient bloom — the go-to ethereal vocal wash.",
    search: "Valhalla Shimmer",
  },
  supermassive: {
    id: "supermassive",
    name: "Valhalla Supermassive",
    brand: "Valhalla",
    role: "Ambient delay / space",
    why: "Free, massive ambient delay networks — huge sound-design value.",
    search: "Valhalla Supermassive",
  },
  rc20: {
    id: "rc20",
    name: "XLN RC-20 Retro Color",
    brand: "XLN Audio",
    role: "Texture / dirt",
    why: "Tape warble, noise, and wear when the vocal needs lo-fi character.",
    search: "XLN RC-20",
  },
  trash: {
    id: "trash",
    name: "iZotope Trash",
    brand: "iZotope",
    role: "Creative distortion",
    why: "Aggressive vocal dirt and multiband smash for trap / alt pop edges.",
    search: "iZotope Trash",
  },
  fresh_air: {
    id: "fresh_air",
    name: "Slate Fresh Air",
    brand: "Slate Digital",
    role: "Air enhancer",
    why: "Fast top-end lift when presence needs sparkle without a harsh shelf.",
    search: "Slate Fresh Air",
  },
  autotune: {
    id: "autotune",
    name: "Antares Auto-Tune Pro",
    brand: "Antares",
    role: "Pitch",
    why: "Industry pitch correction — transparent or hard-tune depending on the ref.",
    search: "Antares Auto-Tune Pro",
  },
  melodyne: {
    id: "melodyne",
    name: "Celemony Melodyne",
    brand: "Celemony",
    role: "Manual pitch",
    why: "Note-level editing when you need surgical pitch without the Auto-Tune sound.",
    search: "Celemony Melodyne",
  },
  imager: {
    id: "imager",
    name: "iZotope Ozone Imager",
    brand: "iZotope",
    role: "Stereo imager",
    why: "Band-limited width on the master — keep lows mono, open the top.",
    search: "iZotope Ozone Imager",
  },
  vintage_verb: {
    id: "vintage_verb",
    name: "Valhalla VintageVerb",
    brand: "Valhalla",
    role: "Ambient / plate reverb",
    why: "Flexible halls and plates for vocal beds without the stock-DAW sound.",
    search: "Valhalla VintageVerb",
  },
  space: {
    id: "space",
    name: "Softube Parallels",
    brand: "Softube",
    role: "Creative dual filter FX",
    why: "Dual filtered FX lanes for modern vocal throws and ambient movement.",
    search: "Softube Parallels",
  },
};

/** Map chain roles → primary + secondary Pro picks */
export const ROLE_AFFILIATES = {
  gain: [],
  eq_subtractive: ["eq_surgical", "soothe"],
  comp1: ["comp_fet", "comp_transparent"],
  comp2: ["comp_opt", "comp_transparent"],
  deess: ["deess", "soothe"],
  sat: ["sat", "sat_mb"],
  eq_air: ["eq_air", "fresh_air", "eq_surgical"],
  limit: ["master_limiter"],
  delay: ["delay", "supermassive"],
  reverb: ["verb", "shimmer", "verb_pro"],
  width: ["microshift"],
  resonance: ["soothe", "eq_surgical"],
  multiband: ["eq_surgical", "soothe"],
  microshift: ["microshift"],
  pitch: ["autotune", "melodyne", "little_alterboy"],
  formant: ["little_alterboy", "vocal_synth"],
  ambient: ["shimmer", "blackhole", "supermassive", "vintage_verb"],
  ambient_bed: ["shimmer", "blackhole", "vintage_verb", "supermassive"],
  granular: ["portal", "crystallizer", "space"],
  texture: ["rc20", "trash", "sat"],
  vocal_design: ["vocal_synth", "portal", "little_alterboy"],
  master_eq: ["master_eq"],
  master_glue: ["master_glue", "master_suite"],
  master_image: ["imager", "master_suite"],
  master_limit: ["master_limiter", "master_suite"],
  master_meter: ["meter"],
};

/**
 * @param {string} role
 * @returns {Array<{ id: string, name: string, brand: string, role: string, why: string, url: string }>}
 */
export function affiliatesForRole(role) {
  const ids = ROLE_AFFILIATES[role] || [];
  return ids
    .map((id) => {
      const p = PRO_CATALOG[id];
      if (!p) return null;
      return {
        ...p,
        url: buildBuyUrl(p.search),
      };
    })
    .filter(Boolean);
}
