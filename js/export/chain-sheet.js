/**
 * Build a printable / PDF-ready HTML report for a full reference-mix analysis.
 * Multi-section document: signature, why, instruments, chain, design, master.
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n, digits = 1) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function pct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—";
}

function humanize(s) {
  return String(s || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stepLines(step) {
  if (step.copy?.length) return step.copy;
  if (step.dials?.length) return step.dials.map((d) => `${d.label}: ${d.value}`);
  if (step.settings) return [String(step.settings)];
  return [];
}

function metricCell(label, value, sub = "") {
  return `
    <div class="xp-metric">
      <span class="xp-metric-k">${esc(label)}</span>
      <span class="xp-metric-v">${esc(value)}</span>
      ${sub ? `<span class="xp-metric-s">${esc(sub)}</span>` : ""}
    </div>`;
}

function bandRow(b) {
  const db = Number(b.dbRelTotal);
  const signed = Number.isFinite(db) ? `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB` : "—";
  return `
    <div class="xp-band">
      <span class="xp-band-label">${esc(b.label)}</span>
      <span class="xp-band-range">${esc(`${b.lo}–${b.hi} Hz`)}</span>
      <span class="xp-band-db">${esc(signed)}</span>
    </div>`;
}

function stepCard(step, index, kind) {
  const n = kind === "send" ? `S${index + 1}` : String(index + 1).padStart(2, "0");
  const lines = stepLines(step)
    .map((line) => `<li>${esc(line)}</li>`)
    .join("");
  const typeLabel = String(step.type || (kind === "send" ? "Send" : "Insert"))
    .trim()
    .toUpperCase();
  const why = step.why ? `<p class="xp-why"><span>Why</span> ${esc(step.why)}</p>` : "";
  const how = step.how ? `<p class="xp-how"><span>How</span> ${esc(step.how)}</p>` : "";

  return `
    <article class="xp-step">
      <div class="xp-step-head">
        <span class="xp-n">${n}</span>
        <div class="xp-step-titles">
          <h3>${esc(step.title)}</h3>
          <p>${esc(step.plugin)}</p>
        </div>
        <span class="xp-type">${esc(typeLabel)}</span>
      </div>
      ${lines ? `<ul class="xp-lines">${lines}</ul>` : ""}
      ${why}
      ${how}
    </article>`;
}

function section(title, body, opts = {}) {
  if (!body) return "";
  return `
    <section class="xp-section${opts.breakBefore ? " xp-break" : ""}">
      <h2>${esc(title)}</h2>
      ${opts.lede ? `<p class="xp-section-lede">${esc(opts.lede)}</p>` : ""}
      ${body}
    </section>`;
}

/** White chain mark matching site logo silhouette — img is reliable in html2canvas */
const MARK_IMG_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" fill="none"><g stroke="#f2f2f2" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" fill="none"><rect x="10" y="6" width="14" height="28" rx="7"/><rect x="18" y="13" width="42" height="14" rx="7"/><rect x="54" y="6" width="14" height="28" rx="7"/><rect x="62" y="13" width="42" height="14" rx="7"/><rect x="96" y="6" width="14" height="28" rx="7"/></g></svg>`
  );

/**
 * @param {{ chain: object, honesty?: string, mode?: string, target?: string, instruments?: object[], highlights?: object[], traits?: object, design?: object, master?: object, estimateNote?: string }} advice
 * @param {{ trackName?: string, generatedAt?: Date, keyLabel?: string, bpm?: number|string, readout?: object, traits?: object }} [meta]
 */
export function buildExportSheetHtml(advice, meta = {}) {
  const chain = advice?.chain;
  if (!chain) throw new Error("No chain to export.");

  const when = (meta.generatedAt || new Date()).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const track = meta.trackName || "Reference mix";
  const modeLabel = advice.mode === "deep" ? "Pro / Deep analysis" : "Standard analysis";
  const target = advice.target || chain.target || "vocal";
  const targetLabel =
    target === "instrumental"
      ? "Instrumental reference analysis"
      : target === "full"
        ? "Full-mix reference analysis"
        : "Vocal reference analysis";
  const signatureLabel =
    target === "instrumental"
      ? "Instrumental signature"
      : target === "full"
        ? "Full-mix signature"
        : "Vocal signature";

  const readout = meta.readout || null;
  const traits = meta.traits || advice.traits || null;
  const instruments = advice.instruments?.length
    ? advice.instruments
    : readout?.instruments || [];

  const keyLabel =
    (meta.keyLabel && String(meta.keyLabel).trim()) ||
    readout?.pitch?.keyLabel ||
    "";
  const bpmRaw =
    meta.bpm != null && meta.bpm !== ""
      ? Number(meta.bpm)
      : Number(readout?.tempo?.bpm);
  const bpmLabel = Number.isFinite(bpmRaw) ? String(Math.round(bpmRaw)) : "";

  /* —— Signature —— */
  const signatureMetrics = [];
  if (bpmLabel) {
    signatureMetrics.push(
      metricCell(
        "BPM",
        bpmLabel,
        readout?.tempo?.feel
          ? `${humanize(readout.tempo.feel)}${readout.tempo.reliable === false ? " · verify" : ""}`
          : readout?.tempo?.reliable === false
            ? "verify by ear"
            : "estimate"
      )
    );
  }
  if (keyLabel) {
    signatureMetrics.push(
      metricCell(
        "Key",
        keyLabel,
        [
          readout?.pitch?.relativeKey ? `rel ${readout.pitch.relativeKey}` : "",
          readout?.pitch?.keyReliable === false ? "uncertain" : "",
        ]
          .filter(Boolean)
          .join(" · ") || "estimate"
      )
    );
  }
  if (readout?.pitch?.f0Hz != null) {
    signatureMetrics.push(
      metricCell("F0", `${fmt(readout.pitch.f0Hz, 1)} Hz`, readout.pitch.register || "")
    );
  }
  if (readout?.centroidHz != null) {
    signatureMetrics.push(metricCell("Centroid", `${fmt(readout.centroidHz, 0)} Hz`, "spectral center"));
  }
  if (readout?.dynamics) {
    const d = readout.dynamics;
    signatureMetrics.push(metricCell("Crest", `${fmt(d.crestDb, 1)} dB`, humanize(traits?.dynamics)));
    signatureMetrics.push(metricCell("Peak", `${fmt(d.peakDb, 1)} dBFS`));
    signatureMetrics.push(metricCell("RMS", `${fmt(d.rmsDb, 1)} dBFS`));
    if (d.shortTermRangeDb != null) {
      signatureMetrics.push(metricCell("Range", `${fmt(d.shortTermRangeDb, 1)} dB`, "short-term"));
    }
  }
  if (readout?.tone) {
    const t = readout.tone;
    const tt = traits?.tone || {};
    signatureMetrics.push(metricCell("Air", fmt(t.air, 2), humanize(tt.air)));
    signatureMetrics.push(metricCell("Sibilance", fmt(t.sibilance, 2), humanize(tt.sibilance)));
    signatureMetrics.push(metricCell("Harsh", fmt(t.harshness, 2), humanize(tt.harshness)));
    signatureMetrics.push(metricCell("Mud", fmt(t.mud, 2), humanize(tt.mud)));
  }
  if (readout?.stereo) {
    signatureMetrics.push(
      metricCell("Correlation", fmt(readout.stereo.correlation, 3), humanize(traits?.stereo))
    );
    signatureMetrics.push(
      metricCell("Side/Mid", fmt(readout.stereo.sideMidRatio, 3), "width proxy")
    );
  }
  if (readout?.loudness?.lufsProxy != null) {
    signatureMetrics.push(metricCell("LUFS≈", fmt(readout.loudness.lufsProxy, 1), "proxy"));
  }
  if (readout?.eqTargets) {
    const e = readout.eqTargets;
    signatureMetrics.push(
      metricCell("EQ centers", `${e.mudHz} / ${e.harshHz} / ${e.deessHz} / ${e.airHz}`, "mud · harsh · de-ess · air")
    );
  }

  const bandsHtml = readout?.bands?.length
    ? `<div class="xp-bands">${readout.bands.map(bandRow).join("")}</div>`
    : "";

  const signatureBody = `
    ${
      signatureMetrics.length
        ? `<div class="xp-metrics">${signatureMetrics.join("")}</div>`
        : `<p class="xp-empty">Signature meters unavailable for this pass.</p>`
    }
    ${bandsHtml ? `<h3 class="xp-subhead">Frequency balance</h3>${bandsHtml}` : ""}
    ${
      readout?.note
        ? `<p class="xp-note"><span>Note</span> ${esc(readout.note)}${
            readout.durationSec != null
              ? ` · ${fmt(readout.durationSec, 1)}s · ${readout.sampleRate || "—"} Hz`
              : ""
          }</p>`
        : ""
    }
  `;

  /* —— Traits / findings —— */
  const findings = (traits?.findings || []).filter(
    (f) => f?.label && !/^(target|source)$/i.test(String(f.label))
  );
  const findingsHtml = findings.length
    ? `<div class="xp-facts">${findings
        .map(
          (f) => `
      <div class="xp-fact">
        <span class="xp-fact-k">${esc(f.label)}</span>
        <p>${esc(f.text)}</p>
      </div>`
        )
        .join("")}</div>`
    : "";
  const summaryHtml = traits?.summary?.length
    ? `<ul class="xp-bullets">${traits.summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : "";
  const traitsDeep = traits?.deep
    ? `<div class="xp-chips">
        ${traits.deep.designLane ? `<span>${esc(humanize(traits.deep.designLane))}</span>` : ""}
        ${traits.deep.spaceCharacter ? `<span>${esc(humanize(traits.deep.spaceCharacter))}</span>` : ""}
        ${traits.deep.denseness ? `<span>Density · ${esc(humanize(traits.deep.denseness))}</span>` : ""}
        ${traits.deep.delivery ? `<span>Delivery · ${esc(humanize(traits.deep.delivery))}</span>` : ""}
        ${traits.deep.attackFeel ? `<span>Attack · ${esc(humanize(traits.deep.attackFeel))}</span>` : ""}
      </div>`
    : "";
  const traitsBody =
    findingsHtml || summaryHtml || traitsDeep
      ? `${traitsDeep}${summaryHtml}${findingsHtml}`
      : "";

  /* —— Why / priorities —— */
  const highlights = advice.highlights || [];
  const highlightsHtml = highlights.length
    ? `<div class="xp-moves">${highlights
        .map(
          (h, i) => `
      <article class="xp-move">
        <span class="xp-n">${String(i + 1).padStart(2, "0")}</span>
        <div>
          <h3>${esc(h.stage || h.title || h.action || "Move")}</h3>
          <p class="xp-move-action">${esc(h.action || h.title || "")}</p>
          <p class="xp-move-because">${esc(h.because || h.body || h.why || "")}</p>
        </div>
      </article>`
        )
        .join("")}</div>`
    : "";

  const orderWhy = chain.orderWhy;
  let orderHtml = "";
  if (orderWhy && typeof orderWhy === "object") {
    const insertOrder = (orderWhy.inserts || [])
      .map((line, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${esc(line)}</li>`)
      .join("");
    const sendOrder = (orderWhy.sends || [])
      .map((line, i) => `<li><span>S${i + 1}</span>${esc(line)}</li>`)
      .join("");
    orderHtml = `
      ${insertOrder ? `<h3 class="xp-subhead">Insert order</h3><ol class="xp-order">${insertOrder}</ol>` : ""}
      ${sendOrder ? `<h3 class="xp-subhead">Send order</h3><ol class="xp-order">${sendOrder}</ol>` : ""}
      ${orderWhy.tip ? `<p class="xp-note"><span>Tip</span> ${esc(orderWhy.tip)}</p>` : ""}
    `;
  } else if (Array.isArray(orderWhy) && orderWhy.length) {
    orderHtml = `<ol class="xp-order">${orderWhy
      .map((line, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${esc(line)}</li>`)
      .join("")}</ol>`;
  }

  const whyBody = [highlightsHtml, orderHtml].filter(Boolean).join("");

  /* —— Instruments —— */
  const instrumentsBody = instruments.length
    ? `<div class="xp-instruments">${instruments
        .map(
          (item) => `
      <div class="xp-instrument">
        <div class="xp-instrument-head">
          <strong>${esc(item.label)}</strong>
          <span>${esc(pct(item.confidence))}</span>
        </div>
        ${item.tip ? `<p>${esc(item.tip)}</p>` : ""}
      </div>`
        )
        .join("")}</div>`
    : "";

  /* —— Chain —— */
  const inserts = (chain.inserts || []).map((s, i) => stepCard(s, i, "insert")).join("");
  const sends = (chain.sends || []).map((s, i) => stepCard(s, i, "send")).join("");
  const honesty = advice.honesty || chain.honesty || "";
  const estimateNote = advice.estimateNote || chain.estimateNote || "";
  const chainIntro = `
    ${honesty ? `<p class="xp-honesty">${esc(honesty)}</p>` : ""}
    ${estimateNote ? `<p class="xp-section-lede">${esc(estimateNote)}</p>` : ""}
  `;
  const chainBody = `
    ${chainIntro}
    <div class="xp-columns">
      <div class="xp-col">
        <h3 class="xp-subhead">Inserts · build in order</h3>
        <div class="xp-stack">${inserts || `<p class="xp-empty">No inserts.</p>`}</div>
      </div>
      <div class="xp-col">
        <h3 class="xp-subhead">Sends</h3>
        <div class="xp-stack">${sends || `<p class="xp-empty">No sends.</p>`}</div>
      </div>
    </div>
  `;

  /* —— Design (Deep) —— */
  const design = advice.design;
  let designBody = "";
  if (design) {
    const cues = (design.cues || [])
      .map(
        (c) => `
      <div class="xp-fact">
        <span class="xp-fact-k">${esc(c.label)}</span>
        <p>${esc(c.text)}</p>
      </div>`
      )
      .join("");
    const layers = (design.layers || [])
      .map(
        (layer) => `
      <article class="xp-layer">
        <h3>${esc(layer.title)}</h3>
        ${layer.goal ? `<p class="xp-layer-goal">${esc(layer.goal)}</p>` : ""}
        <ul class="xp-bullets">${(layer.actions || layer.moves || [])
          .map((a) => `<li>${esc(a)}</li>`)
          .join("")}</ul>
      </article>`
      )
      .join("");
    const checklist = (design.checklist || [])
      .map((item) => `<li>${esc(item)}</li>`)
      .join("");
    designBody = `
      ${design.headline ? `<p class="xp-design-head">${esc(design.headline)}</p>` : ""}
      ${design.blurb ? `<p class="xp-section-lede">${esc(design.blurb)}</p>` : ""}
      ${cues ? `<div class="xp-facts">${cues}</div>` : ""}
      ${layers ? `<div class="xp-layers">${layers}</div>` : ""}
      ${checklist ? `<h3 class="xp-subhead">Before you print</h3><ul class="xp-bullets">${checklist}</ul>` : ""}
    `;
  }

  /* —— Master (Deep) —— */
  const master = advice.master;
  let masterBody = "";
  if (master) {
    const mr = master.readouts || {};
    const masterMetrics = [
      mr.peakDb != null ? metricCell("Peak", `${fmt(mr.peakDb, 1)} dBFS`) : "",
      mr.rmsDb != null ? metricCell("RMS", `${fmt(mr.rmsDb, 1)} dBFS`) : "",
      mr.crestDb != null ? metricCell("Crest", `${fmt(mr.crestDb, 1)} dB`) : "",
      mr.lufsProxy != null ? metricCell("LUFS≈", fmt(mr.lufsProxy, 1)) : "",
      mr.correlation != null ? metricCell("Corr", fmt(mr.correlation, 3)) : "",
      mr.sideMidRatio != null ? metricCell("S/M", fmt(mr.sideMidRatio, 3)) : "",
      mr.centroidHz != null ? metricCell("Centroid", `${fmt(mr.centroidHz, 0)} Hz`) : "",
      mr.bpm != null ? metricCell("BPM", String(Math.round(Number(mr.bpm)))) : "",
      mr.keyLabel ? metricCell("Key", mr.keyLabel) : "",
    ]
      .filter(Boolean)
      .join("");
    const notes = (master.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
    const steps = (master.steps || [])
      .map((s, i) => stepCard(s, i, "insert"))
      .join("");
    const masterBands = (master.bands || []).map(bandRow).join("");
    masterBody = `
      ${master.streamingTarget ? `<p class="xp-section-lede">Streaming target · ${esc(master.streamingTarget)}</p>` : ""}
      ${master.honesty ? `<p class="xp-honesty">${esc(master.honesty)}</p>` : ""}
      ${masterMetrics ? `<div class="xp-metrics">${masterMetrics}</div>` : ""}
      ${notes ? `<h3 class="xp-subhead">Master notes</h3><ul class="xp-bullets">${notes}</ul>` : ""}
      ${steps ? `<h3 class="xp-subhead">Mastering chain</h3><div class="xp-stack">${steps}</div>` : ""}
      ${masterBands ? `<h3 class="xp-subhead">Master bands</h3><div class="xp-bands">${masterBands}</div>` : ""}
    `;
  }

  const musicBits = [keyLabel ? `Key ${keyLabel}` : "", bpmLabel ? `${bpmLabel} BPM` : ""]
    .filter(Boolean)
    .join(" · ");
  const sourceBits = [
    readout?.sourceKind === "stem" ? "Stem" : "Estimate",
    `${instruments.length || 0} source${instruments.length === 1 ? "" : "s"} detected`,
    `${(chain.inserts || []).length} inserts`,
    `${(chain.sends || []).length} sends`,
  ].join(" · ");

  return `
    <div class="xp-sheet" data-export-sheet>
      <header class="xp-top">
        <div class="xp-brand">
          <img class="xp-mark" src="${MARK_IMG_URI}" width="56" height="19" alt="" />
          <span class="xp-word">Chainprint</span>
        </div>
        <div class="xp-meta">
          <p class="xp-doc">${esc(targetLabel)}</p>
          <p class="xp-sub">${esc(modeLabel)} · ${esc(track)} · ${esc(when)}</p>
          ${musicBits ? `<p class="xp-music">${esc(musicBits)}</p>` : ""}
          <p class="xp-sub">${esc(sourceBits)}</p>
        </div>
      </header>

      <p class="xp-lede">Full reference analysis — measured signature, why each move matters, and the complete processing chain with settings. Use this as your session bible; always finish by ear in full mix context.</p>

      ${section(signatureLabel, signatureBody, {
        lede: "What we measured on the reference — the numbers that dialed every stage.",
      })}
      ${section("What stands out", traitsBody, {
        lede: "Plain-language read of the reference character.",
      })}
      ${section("Why this chain", whyBody, {
        lede: "Priority moves first, then the full build-order rationale.",
        breakBefore: true,
      })}
      ${section("Detected sources", instrumentsBody, {
        lede: "Bed / source guesses from this pass — verify by ear.",
      })}
      ${section("Processing chain", chainBody, {
        lede: "Open each processor in order. Set the values below, then A/B against the reference.",
        breakBefore: true,
      })}
      ${section("Design", designBody, {
        lede: design ? "Creative layers on top of the technical chain." : "",
        breakBefore: Boolean(designBody),
      })}
      ${section("Master analysis", masterBody, {
        lede: master ? "Mix-bus / streaming-oriented read and mastering moves." : "",
        breakBefore: Boolean(masterBody),
      })}

      <footer class="xp-foot">
        <span>chainprint.app</span>
        <span>Engineered recreation from the measured reference signature — refine by ear in full mix context.</span>
      </footer>
    </div>
  `;
}

export const EXPORT_SHEET_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500&display=swap");

  .xp-mount {
    position: fixed;
    left: -10000px;
    top: 0;
    pointer-events: none;
    z-index: -1;
  }

  .xp-sheet {
    box-sizing: border-box;
    width: 816px;
    padding: 40px 44px 32px;
    background: #050505;
    color: #f2f2f2;
    font-family: "DM Sans", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .xp-sheet *,
  .xp-sheet *::before,
  .xp-sheet *::after {
    box-sizing: border-box;
  }

  .xp-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 18px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }

  .xp-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .xp-mark {
    display: block;
    width: 56px;
    height: 19px;
    flex-shrink: 0;
    object-fit: contain;
  }

  .xp-word {
    font-family: "Syne", "Arial Narrow", sans-serif;
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.05em;
    line-height: 1;
    color: #f2f2f2;
  }

  .xp-meta {
    text-align: right;
    max-width: 58%;
  }

  .xp-doc {
    margin: 0 0 4px;
    font-family: "Syne", sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }

  .xp-sub {
    margin: 0;
    font-size: 11px;
    color: #8a8a8a;
    letter-spacing: -0.01em;
    line-height: 1.4;
  }

  .xp-music {
    margin: 5px 0 2px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 12px;
    font-weight: 500;
    color: #e8e8e8;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  .xp-lede {
    margin: 16px 0 22px;
    font-size: 12.5px;
    color: #9a9a9a;
    letter-spacing: -0.01em;
    line-height: 1.45;
  }

  .xp-section {
    margin: 0 0 28px;
    padding-top: 4px;
  }

  .xp-section.xp-break {
    padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }

  .xp-section > h2 {
    margin: 0 0 6px;
    font-family: "Syne", sans-serif;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 1.15;
    color: #f4f4f4;
  }

  .xp-section-lede {
    margin: 0 0 12px;
    font-size: 11.5px;
    color: #8a8a8a;
    line-height: 1.4;
  }

  .xp-subhead {
    margin: 16px 0 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6a6a6a;
  }

  .xp-honesty {
    margin: 0 0 10px;
    padding: 10px 12px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(255,255,255,0.03);
    font-size: 12px;
    line-height: 1.45;
    color: #d0d0d0;
  }

  .xp-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .xp-metric {
    display: grid;
    gap: 3px;
    padding: 9px 10px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(255,255,255,0.025);
    min-width: 0;
  }

  .xp-metric-k {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #7a7a7a;
  }

  .xp-metric-v {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px;
    font-weight: 500;
    color: #f2f2f2;
    line-height: 1.2;
    word-break: break-word;
  }

  .xp-metric-s {
    font-size: 10px;
    color: #7a7a7a;
    line-height: 1.25;
  }

  .xp-bands {
    display: grid;
    gap: 4px;
  }

  .xp-band {
    display: grid;
    grid-template-columns: 7rem 1fr auto;
    gap: 10px;
    align-items: baseline;
    padding: 5px 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-size: 11px;
  }

  .xp-band-label {
    color: #d8d8d8;
    font-weight: 500;
  }

  .xp-band-range {
    color: #6a6a6a;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px;
  }

  .xp-band-db {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    color: #e8e8e8;
    font-size: 11px;
  }

  .xp-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .xp-fact {
    padding: 10px 11px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(255,255,255,0.025);
  }

  .xp-fact-k {
    display: block;
    margin-bottom: 4px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #7a7a7a;
  }

  .xp-fact p {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: #c8c8c8;
  }

  .xp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  .xp-chips span {
    padding: 4px 8px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    font-size: 10.5px;
    color: #b8b8b8;
  }

  .xp-bullets {
    margin: 0;
    padding: 0 0 0 1.1rem;
    display: grid;
    gap: 5px;
    font-size: 11.5px;
    line-height: 1.4;
    color: #c4c4c4;
  }

  .xp-moves {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
  }

  .xp-move {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 10px;
    padding: 11px 12px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    background: rgba(255,255,255,0.025);
  }

  .xp-move h3 {
    margin: 0;
    font-family: "Syne", sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: #f4f4f4;
  }

  .xp-move-action {
    margin: 3px 0 0;
    font-size: 12px;
    color: #d0d0d0;
    line-height: 1.35;
  }

  .xp-move-because {
    margin: 5px 0 0;
    font-size: 11px;
    color: #8a8a8a;
    line-height: 1.4;
  }

  .xp-order {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  .xp-order li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 8px;
    font-size: 11.5px;
    line-height: 1.4;
    color: #c8c8c8;
  }

  .xp-order li span {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px;
    color: #7a7a7a;
    padding-top: 1px;
  }

  .xp-instruments {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .xp-instrument {
    padding: 10px 11px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(255,255,255,0.025);
  }

  .xp-instrument-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: baseline;
  }

  .xp-instrument-head strong {
    font-size: 12.5px;
    font-weight: 600;
    color: #f0f0f0;
  }

  .xp-instrument-head span {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    color: #8a8a8a;
  }

  .xp-instrument p {
    margin: 5px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: #8a8a8a;
  }

  .xp-columns {
    display: grid;
    grid-template-columns: 1fr;
    gap: 18px;
    align-items: start;
  }

  .xp-stack {
    display: grid;
    gap: 8px;
  }

  .xp-step {
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.025);
    display: grid;
    gap: 8px;
  }

  .xp-step-head {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
  }

  .xp-n {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 500;
    color: #7a7a7a;
    line-height: 1.35;
    padding-top: 2px;
  }

  .xp-step-titles {
    min-width: 0;
  }

  .xp-step-titles h3 {
    margin: 0;
    font-family: "Syne", sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.25;
    color: #f4f4f4;
  }

  .xp-step-titles p {
    margin: 3px 0 0;
    font-size: 10.5px;
    color: #8f8f8f;
    letter-spacing: -0.01em;
    line-height: 1.3;
  }

  .xp-type {
    display: block;
    margin: 2px 0 0;
    color: #8a8a8a;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.3;
    white-space: nowrap;
    text-align: right;
  }

  .xp-lines {
    list-style: none;
    margin: 0;
    padding: 0 0 0 38px;
    display: grid;
    gap: 3px;
  }

  .xp-lines li {
    position: relative;
    padding-left: 10px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9.5px;
    line-height: 1.4;
    color: #c8c8c8;
  }

  .xp-lines li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #666;
  }

  .xp-why,
  .xp-how {
    margin: 0;
    padding-left: 38px;
    font-size: 10.5px;
    line-height: 1.4;
    color: #8a8a8a;
  }

  .xp-why span,
  .xp-how span {
    display: inline-block;
    margin-right: 6px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6a6a6a;
  }

  .xp-design-head {
    margin: 0 0 6px;
    font-family: "Syne", sans-serif;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: #f0f0f0;
  }

  .xp-layers {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }

  .xp-layer {
    padding: 11px 12px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    background: rgba(255,255,255,0.025);
  }

  .xp-layer h3 {
    margin: 0;
    font-family: "Syne", sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .xp-layer-goal {
    margin: 4px 0 8px;
    font-size: 11px;
    color: #8a8a8a;
    line-height: 1.4;
  }

  .xp-note {
    margin: 10px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: #8a8a8a;
  }

  .xp-note span {
    display: inline-block;
    margin-right: 6px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6a6a6a;
  }

  .xp-empty {
    margin: 0;
    font-size: 11px;
    color: #6a6a6a;
  }

  .xp-foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    margin-top: 8px;
    padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,0.1);
    font-size: 9.5px;
    color: #666;
    letter-spacing: -0.01em;
    line-height: 1.35;
  }

  .xp-foot span:first-child {
    font-family: "Syne", sans-serif;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #8a8a8a;
    white-space: nowrap;
  }
`;
