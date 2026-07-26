/**
 * Tiny inline SVG marks for Why / Design / Signature — break up text walls
 * without turning the studio into an icon farm.
 */

const NS = "http://www.w3.org/2000/svg";

/** @param {string} paths @param {{ viewBox?: string }} [opts] */
function svg(paths, opts = {}) {
  const vb = opts.viewBox || "0 0 24 24";
  return `<svg class="studio-glyph" viewBox="${vb}" width="18" height="18" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const stroke = `fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;

const GLYPHS = {
  tempo: () =>
    svg(
      `<circle cx="12" cy="12" r="8.5" ${stroke}/><path d="M12 7.5v5l3.2 1.8" ${stroke}/>`
    ),
  key: () =>
    svg(
      `<circle cx="9" cy="14" r="3.2" ${stroke}/><path d="M12 14h7.5v2.2M16.2 14v3.2" ${stroke}/>`
    ),
  pitch: () =>
    svg(`<path d="M4 14c2-6 4-8 8-8s6 2 8 8" ${stroke}/><path d="M7 14h10" ${stroke}/>`),
  air: () =>
    svg(
      `<path d="M5 16c2.5-1 4-3.5 7-3.5S16.5 15 19 16" ${stroke}/><path d="M6 11.5c2-1 3.5-2.5 6-2.5s4 1.5 6 2.5" ${stroke}/><path d="M8 7.5c1.4-.7 2.6-1.5 4-1.5s2.6.8 4 1.5" ${stroke}/>`
    ),
  sibilance: () =>
    svg(`<path d="M8 7v10M12 5v14M16 8v8" ${stroke}/>`),
  harsh: () =>
    svg(`<path d="M5 16 9.5 8l3 5 2.5-4L19 16" ${stroke}/>`),
  mud: () =>
    svg(
      `<path d="M4 15.5c2.2-4 4.5-6 8-6s5.8 2 8 6" ${stroke}/><path d="M6 18h12" ${stroke}/>`
    ),
  dynamics: () =>
    svg(`<path d="M5 17V9M9.5 17V6M14 17v-7M19 17V8" ${stroke}/>`),
  stereo: () =>
    svg(
      `<circle cx="8" cy="12" r="3" ${stroke}/><circle cx="16" cy="12" r="3" ${stroke}/><path d="M11 12h2" ${stroke}/>`
    ),
  width: () =>
    svg(`<path d="M4 12h16M7 8l-3 4 3 4M17 8l3 4-3 4" ${stroke}/>`),
  sources: () =>
    svg(
      `<rect x="4.5" y="7" width="6" height="10" rx="1.5" ${stroke}/><rect x="13.5" y="5" width="6" height="14" rx="1.5" ${stroke}/>`
    ),
  space: () =>
    svg(
      `<circle cx="12" cy="12" r="3" ${stroke}/><circle cx="12" cy="12" r="6.5" opacity="0.55" ${stroke}/><circle cx="12" cy="12" r="9.5" opacity="0.3" ${stroke}/>`
    ),
  layer: () =>
    svg(
      `<path d="M4 9.5 12 5l8 4.5-8 4.5z" ${stroke}/><path d="M4 13.5 12 18l8-4.5" ${stroke}/><path d="M4 11.5 12 16l8-4.5" opacity="0.55" ${stroke}/>`
    ),
  print: () =>
    svg(
      `<rect x="5" y="7" width="14" height="11" rx="2" ${stroke}/><path d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7" ${stroke}/>`
    ),
  eq: () =>
    svg(`<path d="M5 16V10M9.5 16V7M14 16v-5M19 16V9" ${stroke}/>`),
  gain: () =>
    svg(
      `<path d="M6 15.5c0-4 2.5-7.5 6-7.5s6 3.5 6 7.5" ${stroke}/><path d="M12 8V5.5" ${stroke}/>`
    ),
  send: () =>
    svg(`<path d="M5 12h10M12 7l5 5-5 5" ${stroke}/><path d="M5 7v10" ${stroke}/>`),
  balance: () =>
    svg(
      `<path d="M12 4v16M5 10h14" ${stroke}/><circle cx="8" cy="10" r="2.2" ${stroke}/><circle cx="16" cy="10" r="2.2" ${stroke}/>`
    ),
  lowend: () =>
    svg(`<path d="M4 16c3-1 5-7 8-7s5 6 8 7" ${stroke}/>`),
  topend: () =>
    svg(`<path d="M4 14c3 3 5-5 8-5s5 8 8 5" ${stroke}/>`),
  spark: () =>
    svg(`<path d="M12 3.5 13.8 9H19l-4 3.2L16.6 18 12 14.6 7.4 18l1.6-5.8L5 9h5.2z" ${stroke}/>`),
  chain: () =>
    svg(
      `<rect x="3.5" y="9" width="7" height="6" rx="3" ${stroke}/><rect x="9.5" y="9" width="7" height="6" rx="3" ${stroke}/><rect x="15.5" y="9" width="5" height="6" rx="3" ${stroke}/>`
    ),
  compare: () =>
    svg(
      `<path d="M7 5v14M17 5v14" ${stroke}/><path d="M4 9h6M14 15h6" ${stroke}/>`
    ),
  why: () =>
    svg(
      `<circle cx="12" cy="12" r="8.5" ${stroke}/><path d="M12 10.5v5.5M12 7.8v.2" ${stroke}/>`
    ),
  share: () =>
    svg(
      `<circle cx="18" cy="6" r="2.2" ${stroke}/><circle cx="6" cy="12" r="2.2" ${stroke}/><circle cx="18" cy="18" r="2.2" ${stroke}/><path d="M8 11.2 16 7.2M8 12.8l8 4" ${stroke}/>`
    ),
  file: () =>
    svg(
      `<path d="M7 4.5h7l4 4V19.5H7z" ${stroke}/><path d="M14 4.5V9h4.5" ${stroke}/>`
    ),
  mic: () =>
    svg(
      `<rect x="9" y="3.5" width="6" height="10" rx="3" ${stroke}/><path d="M7 11.5a5 5 0 0 0 10 0M12 16.5v3.5M9 20h6" ${stroke}/>`
    ),
  account: () =>
    svg(
      `<circle cx="12" cy="9" r="3.2" ${stroke}/><path d="M5.5 19c1.4-3.2 3.6-4.8 6.5-4.8S17.1 15.8 18.5 19" ${stroke}/>`
    ),
  default: () =>
    svg(`<circle cx="12" cy="12" r="7.5" ${stroke}/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>`),
};

/**
 * @param {string} label
 * @returns {keyof typeof GLYPHS}
 */
export function glyphKeyForLabel(label) {
  const s = String(label || "").toLowerCase();
  if (/tempo|bpm/.test(s)) return "tempo";
  if (/^key|relative|finder/.test(s)) return "key";
  if (/pitch|f0|register/.test(s)) return "pitch";
  if (/air|bright/.test(s)) return "air";
  if (/sibil/.test(s)) return "sibilance";
  if (/harsh|bite|presence/.test(s)) return "harsh";
  if (/mud|low-mid|box/.test(s)) return "mud";
  if (/dynamic|crest|compress|loud|range|rms|transient|density|delivery/.test(s))
    return "dynamics";
  if (/stereo|corr|side|width|mono/.test(s)) return "stereo";
  if (/source|instrument/.test(s)) return "sources";
  if (/space|reverb|ambient|room/.test(s)) return "space";
  if (/print|check|master|limit|pdf|ableton|rack|export/.test(s)) return "print";
  if (/eq|subtract|carve|signature|analyze|analys/.test(s)) return "eq";
  if (/gain|level/.test(s)) return "gain";
  if (/delay|send|throw/.test(s)) return "send";
  if (/balance|target|standard|deep|mode/.test(s)) return "balance";
  if (/low end|bass|kick|instrumental|full mix/.test(s)) return "lowend";
  if (/top end|hat|cymbal/.test(s)) return "topend";
  if (/lane|design|layer|bed|double/.test(s)) return "layer";
  if (/chain|stage|insert/.test(s)) return "chain";
  if (/compare|a\/b|gap/.test(s)) return "compare";
  if (/why|rationale|explain|glossary|help/.test(s)) return "why";
  if (/share|link|publish/.test(s)) return "share";
  if (/library|file|upload|reference|session/.test(s)) return "file";
  if (/vocal|mic|dry/.test(s)) return "mic";
  if (/account|settings|plan|free|pro|profile/.test(s)) return "account";
  if (/blend|merge|hybrid/.test(s)) return "spark";
  return "default";
}

/** @param {string} label */
export function glyphHtml(label) {
  const key = glyphKeyForLabel(label);
  const make = GLYPHS[key] || GLYPHS.default;
  return make();
}

/**
 * Map categorical / numeric subs to a 0–1 fill for mini meters.
 * @param {string} key
 * @param {string} value
 * @param {string} sub
 */
export function meterLevelForReadout(key, value, sub) {
  const cat = String(sub || value || "").toLowerCase().replace(/_/g, " ");
  if (/elevated|hot|forward|wide|fast|heavily/.test(cat)) return 0.86;
  if (/recessed|dark|narrow|soft|open|ballad/.test(cat)) return 0.28;
  if (/balanced|controlled|dynamic|mid|pulse|typical/.test(cat)) return 0.52;

  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return 0.45;

  const k = String(key || "").toLowerCase();
  if (k.includes("bpm")) return Math.max(0.15, Math.min(0.95, (n - 60) / 120));
  if (k.includes("corr")) return Math.max(0.1, Math.min(0.95, n));
  if (k.includes("side")) return Math.max(0.1, Math.min(0.95, n * 2.2));
  if (k.includes("crest") || k.includes("range"))
    return Math.max(0.12, Math.min(0.92, n / 24));
  if (k.includes("rms") || k.includes("loud") || k.includes("peak") || k.includes("air") || k.includes("mud") || k.includes("harsh") || k.includes("sibil") || k.includes("transient")) {
    // dB-ish negatives → map -30..0 into bar
    const t = (n + 30) / 30;
    return Math.max(0.12, Math.min(0.92, t));
  }
  if (k.includes("centroid") || k.includes("f0") || k.includes("hz"))
    return Math.max(0.15, Math.min(0.9, Math.log10(Math.max(n, 40)) / 4));
  return 0.45;
}

// Silence unused NS warning in tooling that scans imports
void NS;
