/**
 * Unified plugin face — one studio-rack language (no DAW skins).
 * Flat cards, mono dials, shared EQ graph.
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatHz(hz) {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz`;
  return `${Math.round(hz)} Hz`;
}

function bandDbAt(freq, band) {
  const f = Math.max(20, freq);
  if (band.type === "hpf") {
    const n = (band.slope || 24) / 6;
    return -10 * Math.log10(1 + Math.pow(band.freq / f, 2 * n));
  }
  if (band.type === "lpf") {
    const n = (band.slope || 24) / 6;
    return -10 * Math.log10(1 + Math.pow(f / band.freq, 2 * n));
  }
  if (band.type === "highshelf") {
    const g = band.gain || 0;
    const t = (f / band.freq) ** 2;
    return g * (t / (1 + t));
  }
  if (band.type === "lowshelf") {
    const g = band.gain || 0;
    const t = (band.freq / f) ** 2;
    return g * (t / (1 + t));
  }
  const g = band.gain || 0;
  const q = Math.max(0.3, band.q || 1);
  const w = (f / band.freq - band.freq / f) * q;
  return g / (1 + w * w);
}

function eqGraph(bands) {
  const w = 560;
  const h = 160;
  const padX = 28;
  const padY = 16;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2 - 8;
  const minF = 20;
  const maxF = 20000;
  const minG = -18;
  const maxG = 18;
  const list = bands || [];

  const xOf = (hz) => padX + (Math.log10(hz / minF) / Math.log10(maxF / minF)) * plotW;
  const yOf = (db) => padY + ((maxG - db) / (maxG - minG)) * plotH;

  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const hz = minF * Math.pow(maxF / minF, t);
    let db = 0;
    for (const b of list) db += bandDbAt(hz, b);
    db = Math.max(minG, Math.min(maxG, db));
    pts.push([xOf(hz), yOf(db)]);
  }
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const zeroY = yOf(0);

  const markers = list
    .map((b) => {
      const x = xOf(b.freq);
      const y = yOf(
        b.type === "hpf" || b.type === "lpf" ? 0 : Math.max(minG, Math.min(maxG, b.gain || 0))
      );
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="rack-eq-dot"/>
        <text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" class="rack-eq-lab">${esc(b.label || formatHz(b.freq))}</text>`;
    })
    .join("");

  const ticks = [100, 1000, 10000]
    .map((hz) => {
      const x = xOf(hz);
      const lab = hz >= 1000 ? `${hz / 1000}k` : String(hz);
      return `<line x1="${x}" y1="${padY}" x2="${x}" y2="${padY + plotH}" class="rack-eq-grid"/>
        <text x="${x}" y="${h - 4}" class="rack-eq-tick">${lab}</text>`;
    })
    .join("");

  return `
    <svg class="rack-eq" viewBox="0 0 ${w} ${h}" role="img" aria-label="EQ curve">
      <rect x="${padX}" y="${padY}" width="${plotW}" height="${plotH}" class="rack-eq-plot"/>
      <line x1="${padX}" y1="${zeroY}" x2="${padX + plotW}" y2="${zeroY}" class="rack-eq-zero"/>
      ${ticks}
      <path d="${line}" class="rack-eq-curve"/>
      ${markers}
    </svg>`;
}

function dial(label, value) {
  return `
    <div class="rack-dial">
      <span class="rack-dial-val">${esc(value)}</span>
      <span class="rack-dial-lab">${esc(label)}</span>
    </div>`;
}

function dialRow(items) {
  if (!items?.length) return "";
  return `<div class="rack-dials">${items.map(([l, v]) => dial(l, v)).join("")}</div>`;
}

function copyList(lines) {
  if (!lines?.length) return "";
  return `<ul class="rack-copy">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

function rackShell(name, body, howto) {
  return `
    <div class="rack">
      <header class="rack-bar">
        <span class="rack-name">${esc(name)}</span>
        <span class="rack-badge">Match in your DAW</span>
      </header>
      <div class="rack-body">${body}</div>
      ${howto ? `<div class="rack-howto">${howto}</div>` : ""}
    </div>`;
}

function renderEq(v, name, copy) {
  const bands = v.bands || [];
  const dials = bands.map((b) => {
    if (b.type === "hpf") return ["High-pass", formatHz(b.freq)];
    if (b.type === "lpf") return ["Low-pass", formatHz(b.freq)];
    if (b.type === "highshelf" || b.type === "lowshelf") {
      const g = b.gain || 0;
      return [b.label || "Shelf", `${g > 0 ? "+" : ""}${Number(g).toFixed(1)} dB @ ${formatHz(b.freq)}`];
    }
    const g = b.gain || 0;
    return [b.label || "Band", `${g > 0 ? "+" : ""}${Number(g).toFixed(1)} dB @ ${formatHz(b.freq)}`];
  });
  return rackShell(
    name,
    `${eqGraph(bands)}${dialRow(dials)}`,
    copyList(copy)
  );
}

function renderComp(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Ratio", `${v.ratio}:1`],
      ["Attack", `${v.attackMs} ms`],
      ["Release", `~${v.releaseMs} ms`],
      ["GR", `~${v.grDb} dB`],
    ]),
    copyList(copy)
  );
}

function renderDeess(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Frequency", formatHz(v.freq)],
      ["Reduction", `~${v.reductionDb} dB`],
      ["Target", "S / T peaks"],
    ]),
    copyList(copy)
  );
}

function renderGain(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Peaks", `${v.peakLow} to ${v.peakHigh} dBFS`],
      ["Headroom", `~${v.headroomDb} dB`],
    ]),
    copyList(copy)
  );
}

function renderSat(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Drive", String(v.drive)],
      ["Character", v.character || "warm"],
      ["Blend", "Barely audible"],
    ]),
    copyList(copy)
  );
}

function renderLimiter(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Catch", `~${v.catchDb} dB`],
      ["True peak", v.truePeak ? "On" : "Off"],
    ]),
    copyList(copy)
  );
}

function renderDelay(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Time", v.time],
      ["Feedback", `${v.feedbackPct}%`],
      ["LPF return", formatHz(v.lowpassHz)],
    ]),
    copyList(copy)
  );
}

function renderReverb(v, name, copy) {
  return rackShell(
    name,
    dialRow([
      ["Size", v.size || "Short plate"],
      ["Pre-delay", `${v.preDelayMs ?? 20} ms`],
      ["Return", "High-pass · tuck under vocal"],
    ]),
    copyList(copy)
  );
}

function renderGeneric(name, dials, copy) {
  const pairs = (dials || []).map((d) => [d.label, d.value]);
  return rackShell(name, dialRow(pairs), copyList(copy));
}

/**
 * @param {{ plugin: string, visual?: object, copy?: string[], dials?: Array<{label:string,value:string}> }} step
 */
export function renderPluginFace(step) {
  if (!step?.visual && !step?.dials?.length && !step?.copy?.length) return "";
  const name = step.plugin || step.title || "Processor";
  const v = step.visual || {};
  const copy = step.copy;

  let body = "";
  if (v.kind === "eq") body = renderEq(v, name, copy);
  else if (v.kind === "compressor") body = renderComp(v, name, copy);
  else if (v.kind === "deesser") body = renderDeess(v, name, copy);
  else if (v.kind === "gain") body = renderGain(v, name, copy);
  else if (v.kind === "saturator") body = renderSat(v, name, copy);
  else if (v.kind === "limiter") body = renderLimiter(v, name, copy);
  else if (v.kind === "delay") body = renderDelay(v, name, copy);
  else if (v.kind === "reverb") body = renderReverb(v, name, copy);
  else body = renderGeneric(name, step.dials, copy);

  return `
    <div class="plugin-face">
      ${body}
    </div>`;
}
