/**
 * Plain-language explainers for Signature / Master / Compare readout boxes.
 * Keys match the labels rendered in the UI.
 */

/** @typedef {{ what: string, values?: Record<string, string> }} GlossaryEntry */

/** @type {Record<string, GlossaryEntry>} */
const METRICS = {
  BPM: {
    what: "Estimated tempo of the reference. Use it to sync delays, throws, and rhythmic FX.",
    values: {
      pulse: "A clear, steady beat was detected.",
      ballad: "Reads slow / spacious — longer spaces and slower throws usually fit.",
      midtempo: "Sits in a moderate groove — classic pop/R&B pocket.",
      fast: "Up-tempo pulse — keep FX shorter so the mix stays tight.",
    },
  },
  Key: {
    what: "Estimated musical key of the mix. Helpful for tuning doubles, harmonies, and melodic FX.",
  },
  "Key?": {
    what: "Key guess is uncertain — two keys are close. Verify by ear or on a stem before committing.",
  },
  Relative: {
    what: "The relative major/minor of the estimated key (same notes, different center).",
  },
  F0: {
    what: "Approximate lead pitch center (fundamental). Shows where the vocal/lead tends to live in Hz.",
  },
  Centroid: {
    what: "Spectral “center of gravity.” Higher = brighter overall tone; lower = darker / heavier low-mid weight.",
  },
  Crest: {
    what: "Peak-to-average ratio. Low crest = smashed / loud and dense; high crest = more dynamic and open.",
    values: {
      "heavily limited": "Very low crest — the mix is already heavily limited or crushed.",
      controlled: "Competitive density — loud but still some punch left.",
      dynamic: "Healthy dynamics — room to compress without destroying life.",
      open: "Very open / dynamic — lots of headroom and transient punch.",
    },
  },
  Peak: {
    what: "Loudest sample peak in the full mix (dBFS). Watch this for clipping before limiting.",
  },
  RMS: {
    what: "Average loudness level. Higher (less negative) usually feels louder and fuller.",
  },
  Range: {
    what: "How much short-term level moves around. Larger range = more dynamic phrases; smaller = more even.",
  },
  Air: {
    what: "Very-high-frequency sparkle (air band). Affects sheen, breath, and “expensive” top end.",
    values: {
      elevated: "Air is forward — bright, open top. Don’t over-boost highs.",
      balanced: "Air sits in a typical pocket for this style.",
      recessed: "Air is pulled back — darker / closer. A gentle high shelf may help.",
    },
  },
  Sibilance: {
    what: "Energy in the “S / T / ch” region. High = spitty consonants that need de-essing.",
    values: {
      elevated: "Sibilance is hot — prioritize a de-esser before brightening more.",
      balanced: "Sibilance looks typical — light de-ess only if you hear spit.",
      recessed: "Sibilance is mild — less de-ess needed; don’t dull the lyric.",
    },
  },
  Harsh: {
    what: "Upper-mid bite / edge. High values feel shouty or fatiguing in headphones.",
    values: {
      elevated: "Harshness is forward — a measured cut in the upper mids usually helps.",
      balanced: "Upper mids look controlled.",
      recessed: "Upper mids are soft — presence may need a gentle lift instead of a cut.",
    },
  },
  Mud: {
    what: "Low-mid buildup (boxy / cloudy region). High mud masks clarity and consonants.",
    values: {
      elevated: "Low-mids are heavy — carve body carefully so the lead stays clear.",
      balanced: "Low-mids look reasonable.",
      recessed: "Low-mids are light — the lead may need body more than a mud cut.",
    },
  },
  Corr: {
    what: "L/R correlation. Near 1.0 = mono-safe; lower = more stereo difference (can collapse in mono).",
    values: {
      wide: "Stereo field is wide — keep the lead centered; put width on doubles/FX.",
      focused: "Stereo image is focused — solid for a centered lead.",
      narrow: "Very mono-ish image — little side energy.",
    },
  },
  "Side/Mid": {
    what: "Side energy vs mid (center). Higher = wider stereo; lower = more centered / mono.",
  },
  "Loud ≈": {
    what: "Ballpark loudness proxy (not certified LUFS). Use it to sense how competitive the mix is — verify with a real meter before delivery.",
  },
  Transients: {
    what: "How punchy / spiky the attack is. Higher = sharper hits; lower = softer, more rounded attacks.",
    values: {
      "bright transients": "Attacks are bright and forward — watch de-ess and compressor attack.",
      "soft attack": "Attacks are rounded — less spit, more body.",
      "balanced attack": "Transient feel sits in a middle pocket.",
    },
  },
  "EQ peaks": {
    what: "Suggested problem centers: mud Hz / harsh Hz — starting points for surgical cuts, not absolute truth.",
  },
  Density: {
    what: "How crushed vs open the mix feels from crest factor. Guides how hard you can compress the lead.",
    values: {
      "radio dense": "Very dense / smashy — expect serial compression and light limiting on the vocal.",
      controlled: "Competitive but not crushed — glue without killing punch.",
      "open mix": "Open and dynamic — leave more headroom; don’t over-squash.",
    },
  },
  Delivery: {
    what: "How loud the reference sits for modern streaming. Tells you whether to chase loudness or protect dynamics.",
    values: {
      "hot stream": "Extremely loud — already past typical streaming targets. Don’t push the vocal louder to “match.”",
      "streaming loud": "Near common streaming loudness. Loudness work belongs on the bus/master, not the vocal alone.",
      competitive: "Competitive commercial level — solid target without being crushed.",
      dynamic: "More dynamic / quieter than hot streams — preserve life; don’t over-limit to catch up.",
    },
  },
  Lane: {
    what: "Deep sound-design lane — the production vibe this mix leans toward (atmosphere, aggression, intimacy, width).",
    values: {
      "polished lead": "Clean, modern lead focus — tasteful FX, not the star.",
      atmospheric: "Mood and ambient layers carry a lot of the record’s character.",
      "aggressive pop": "Forward, designed grit and tight FX throws fit this pocket.",
      intimate: "Close, dry-forward lead — short space and micro-moves only.",
      "wide fx": "Stereo interest comes from doubles, microshift, and send width.",
    },
  },
  Space: {
    what: "How wet/wide the space around the lead feels from stereo measurements.",
    values: {
      "wet wide": "Wide, ambient space — FX and sides are doing heavy lifting.",
      supported: "Natural supported space — present but not drowning the lead.",
      "dry forward": "Dry and forward — the lead is close; keep reverb short and low.",
    },
  },
  Brightness: {
    what: "How much brighter or darker your mix is vs the reference (from spectral centroid).",
  },
  Dynamics: {
    what: "How your mix’s punch / density compares to the reference crest.",
  },
  Loudness: {
    what: "How your mix’s average level compares to the reference.",
  },
  Width: {
    what: "How your stereo width compares to the reference.",
  },
  "Mud (200–500)": {
    what: "Low-mid weight gap vs the reference (roughly 200–500 Hz). Heavier = boxier / cloudier; leaner = thinner body.",
  },
  Harshness: {
    what: "Upper-mid bite gap vs the reference (roughly 2–5 kHz). Hotter can fatigue; smoother may lack edge.",
  },
};

/**
 * @param {string} raw
 */
function norm(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * @param {string} key
 * @param {string} [value]
 * @param {string} [sub]
 * @returns {{ what: string, reading: string | null }}
 */
export function explainReadout(key, value = "", sub = "") {
  const entry = METRICS[key] || null;
  const what =
    entry?.what ||
    "A measured trait from this reference. Use it to understand why the chain is dialed this way.";

  const candidates = [value, sub]
    .map(norm)
    .filter(Boolean)
    // Drop numeric / technical crumbs that aren't categorical labels
    .filter((s) => !/^[-+]?\d/.test(s) && !/%/.test(s) && !/hz|db|conf|vs |proxy|index|stereo|level|full mix|estimate|pro|deep/i.test(s));

  let reading = null;
  if (entry?.values) {
    for (const c of candidates) {
      if (entry.values[c]) {
        reading = entry.values[c];
        break;
      }
      // Partial match for "low conf. 42%" style subs that include a feel word
      for (const [label, text] of Object.entries(entry.values)) {
        if (c.includes(label)) {
          reading = text;
          break;
        }
      }
      if (reading) break;
    }
  }

  // Tone/dynamics labels often live only in `sub`
  if (!reading) {
    const toneShared = {
      elevated: "This band reads elevated vs a typical pocket.",
      balanced: "This band sits in a typical / balanced pocket.",
      recessed: "This band reads recessed (pulled back) vs a typical pocket.",
    };
    for (const c of [norm(value), norm(sub)]) {
      if (toneShared[c]) {
        reading = toneShared[c];
        break;
      }
    }
  }

  return { what, reading };
}

/**
 * @param {string} key
 * @param {string} value
 * @param {string} sub
 * @param {(s: string) => string} escape
 * @param {{ className?: string, meter?: number, glyph?: string }} [opts]
 */
export function readoutCardHtml(key, value, sub, escape, opts = {}) {
  const { what, reading } = explainReadout(key, value, sub);
  const extra = opts.className ? ` ${opts.className}` : "";
  const readingHtml = reading
    ? `<p class="readout-reading"><span class="readout-reading-label">This reading</span> ${escape(reading)}</p>`
    : "";
  const level =
    typeof opts.meter === "number" && Number.isFinite(opts.meter)
      ? Math.max(0, Math.min(1, opts.meter))
      : null;
  const meterHtml =
    level == null
      ? ""
      : `<span class="readout-meter" aria-hidden="true"><span class="readout-meter-fill" style="width:${Math.round(level * 100)}%"></span></span>`;
  const glyphHtml = opts.glyph || "";
  return `
    <button type="button" class="readout is-explainable${extra}" aria-expanded="false">
      <span class="readout-main">
        <span class="key">${glyphHtml}<span class="readout-key-text">${escape(key)}</span><span class="readout-hint" aria-hidden="true">?</span></span>
        <span class="value">${escape(value)}</span>
        ${meterHtml}
        <span class="sub">${escape(sub)}</span>
      </span>
      <span class="readout-def" hidden>
        <p class="readout-what">${escape(what)}</p>
        ${readingHtml}
      </span>
    </button>`;
}

/**
 * Accordion behavior: one open card per grid (or whole document if no grid).
 * @param {ParentNode} [root]
 */
export function bindReadoutExplainers(root = document) {
  root.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest(".readout.is-explainable") : null;
    if (!(btn instanceof HTMLButtonElement)) return;
    const grid = btn.closest(".readout-grid");
    const open = btn.getAttribute("aria-expanded") === "true";
    if (grid) {
      grid.querySelectorAll(".readout.is-explainable[aria-expanded='true']").forEach((el) => {
        if (el === btn) return;
        el.setAttribute("aria-expanded", "false");
        el.querySelector(".readout-def")?.setAttribute("hidden", "");
      });
    }
    btn.setAttribute("aria-expanded", String(!open));
    const def = btn.querySelector(".readout-def");
    if (def) {
      if (open) def.setAttribute("hidden", "");
      else def.removeAttribute("hidden");
    }
  });
}
