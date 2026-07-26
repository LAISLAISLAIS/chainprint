/**
 * Build a Web Audio approximation of a Chainprint chain from step.visual params.
 *
 * Tuned for *preview* clarity — dials are scaled gentler than the written chain
 * so A/B against dry stays musical instead of washed / pumped / phasey.
 */

/**
 * @typedef {{ input: AudioNode, output: AudioNode, dispose: () => void }} ChainFxGraph
 */

/** Preview intensity — keep below 1 so the chain suggests rather than replaces the take */
const PREVIEW_EQ = 0.62;
const PREVIEW_COMP_MAKEUP = 0.35;
const PREVIEW_SEND = 0.55;

/**
 * @param {AudioContext} ctx
 * @param {{ inserts?: object[], sends?: object[] } | null} chain
 * @returns {ChainFxGraph | null}
 */
export function buildChainFx(ctx, chain) {
  if (!ctx || !chain) return null;

  const inserts = Array.isArray(chain.inserts) ? chain.inserts : [];
  const sends = Array.isArray(chain.sends) ? chain.sends : [];
  if (!inserts.length && !sends.length) return null;

  const nodes = [];
  const input = ctx.createGain();
  input.gain.value = 1;
  nodes.push(input);

  let cursor = input;
  let usedCompressor = false;

  for (const step of inserts) {
    const kind = String(step?.visual?.kind || "");
    // One compressor in the preview is enough — stacked DynamicsCompressors pump hard
    if ((kind === "compressor" || kind === "limiter") && usedCompressor) continue;
    const built = buildStepNodes(ctx, step?.visual, "insert");
    if (!built) continue;
    if (kind === "compressor" || kind === "limiter") usedCompressor = true;
    cursor.connect(built.input);
    cursor = built.output;
    nodes.push(...built.nodes);
  }

  const insertOut = ctx.createGain();
  insertOut.gain.value = 1;
  cursor.connect(insertOut);
  nodes.push(insertOut);

  const mix = ctx.createGain();
  mix.gain.value = 1;
  insertOut.connect(mix);
  nodes.push(mix);

  let sendCount = 0;
  for (const step of sends) {
    if (sendCount >= 2) break; // cap wet clutter
    const built = buildStepNodes(ctx, step?.visual, "send");
    if (!built) continue;
    const sendGain = ctx.createGain();
    const base = typeof built.sendLevel === "number" ? built.sendLevel : 0.16;
    sendGain.gain.value = base * PREVIEW_SEND;
    insertOut.connect(sendGain);
    sendGain.connect(built.input);
    built.output.connect(mix);
    nodes.push(sendGain, ...built.nodes);
    sendCount += 1;
  }

  // Soft ceiling so stacked stages don't clip into the speakers
  const output = ctx.createGain();
  output.gain.value = 0.85;
  mix.connect(output);
  nodes.push(output);

  return {
    input,
    output,
    dispose() {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/**
 * @param {AudioContext} ctx
 * @param {object | null | undefined} visual
 * @param {'insert' | 'send'} placement
 */
function buildStepNodes(ctx, visual, placement) {
  if (!visual || typeof visual !== "object") return null;
  const kind = String(visual.kind || "");

  switch (kind) {
    case "gain":
      return buildGain(ctx, visual);
    case "eq":
      return buildEq(ctx, visual);
    case "compressor":
      return buildCompressor(ctx, visual, false);
    case "limiter":
      return buildCompressor(ctx, visual, true);
    case "delay":
      return buildDelay(ctx, visual);
    case "reverb":
      return buildReverb(ctx, visual);
    case "deesser":
      return buildDeesser(ctx, visual);
    case "saturator":
      return buildSaturator(ctx, visual);
    case "width":
    case "imaging":
      // Mid-side width is unreliable on mono vocals and often sounds phasey — skip in preview
      return placement === "send" ? null : passThrough(ctx);
    case "modulation":
      return buildModulation(ctx, visual, placement);
    default:
      return placement === "send" ? null : passThrough(ctx);
  }
}

function passThrough(ctx) {
  const g = ctx.createGain();
  g.gain.value = 1;
  return { input: g, output: g, nodes: [g] };
}

function buildGain(ctx, visual) {
  const g = ctx.createGain();
  // Instructional peak targets — tiny trim only so we don't starve later stages
  const headroom = Number(visual.headroomDb);
  const trim = Number.isFinite(headroom) ? Math.min(0, -Math.min(4, headroom) * 0.08) : -0.2;
  g.gain.value = dbToGain(trim);
  return { input: g, output: g, nodes: [g] };
}

function buildEq(ctx, visual) {
  const bands = Array.isArray(visual.bands) ? visual.bands : [];
  if (!bands.length) return passThrough(ctx);

  const nodes = [];
  let input = null;
  let prev = null;

  for (const band of bands) {
    const filter = ctx.createBiquadFilter();
    const type = String(band.type || "bell");
    if (type === "hpf" || type === "highpass") filter.type = "highpass";
    else if (type === "lpf" || type === "lowpass") filter.type = "lowpass";
    else if (type === "highshelf") filter.type = "highshelf";
    else if (type === "lowshelf") filter.type = "lowshelf";
    else filter.type = "peaking";

    const freq = clamp(Number(band.freq) || 1000, 20, 20000);
    filter.frequency.value = freq;

    if (filter.type === "peaking" || filter.type === "lowshelf" || filter.type === "highshelf") {
      // Scale cuts/boosts so preview doesn't gut the take
      filter.gain.value = clamp((Number(band.gain) || 0) * PREVIEW_EQ, -10, 8);
    }
    if (filter.type === "peaking" || filter.type === "lowpass" || filter.type === "highpass") {
      const q = Number(band.q);
      filter.Q.value = Number.isFinite(q) && q > 0 ? clamp(q, 0.3, 8) : type === "hpf" ? 0.7 : 0.9;
    }
    if ((type === "hpf" || type === "highpass") && Number(band.slope) >= 24) {
      // Cascade a second gentle HPF instead of resonant Q
      filter.Q.value = 0.707;
      nodes.push(filter);
      if (!input) input = filter;
      if (prev) prev.connect(filter);
      prev = filter;
      const steep = ctx.createBiquadFilter();
      steep.type = "highpass";
      steep.frequency.value = freq;
      steep.Q.value = 0.707;
      prev.connect(steep);
      nodes.push(steep);
      prev = steep;
      continue;
    }

    nodes.push(filter);
    if (!input) input = filter;
    if (prev) prev.connect(filter);
    prev = filter;
  }

  return { input, output: prev, nodes };
}

function buildCompressor(ctx, visual, isLimiter) {
  const comp = ctx.createDynamicsCompressor();
  const ratio = Number(visual.ratio);
  const attackMs = Number(visual.attackMs);
  const releaseMs = Number(visual.releaseMs);
  const grDb = Number(visual.grDb ?? visual.catchDb);

  comp.ratio.value = clamp(
    isLimiter ? Math.max(8, ratio || 12) : Number.isFinite(ratio) ? Math.min(ratio, 6) : 3,
    1.5,
    12
  );
  comp.attack.value = clamp((Number.isFinite(attackMs) ? attackMs : isLimiter ? 2 : 18) / 1000, 0.001, 0.2);
  comp.release.value = clamp((Number.isFinite(releaseMs) ? releaseMs : 120) / 1000, 0.04, 0.6);
  comp.knee.value = isLimiter ? 4 : 12;

  // Softer threshold than the written chain — preview shouldn't squash
  const targetGr = Number.isFinite(grDb) ? Math.min(grDb, isLimiter ? 2.5 : 4) : isLimiter ? 1.5 : 3;
  comp.threshold.value = clamp(isLimiter ? -4 - targetGr : -14 - targetGr, -40, -6);

  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(Math.min(targetGr * PREVIEW_COMP_MAKEUP, isLimiter ? 1.2 : 2.5));

  comp.connect(makeup);
  return { input: comp, output: makeup, nodes: [comp, makeup] };
}

function buildDelay(ctx, visual) {
  const delayMs = parseDelayMs(visual.time) ?? 280;
  const feedbackPct = Number(visual.feedbackPct);
  const lowpassHz = Number(visual.lowpassHz);

  const input = ctx.createGain();
  const delay = ctx.createDelay(Math.min(2, delayMs / 1000 + 0.05));
  delay.delayTime.value = clamp(delayMs / 1000, 0.02, 1.5);

  const feedback = ctx.createGain();
  feedback.gain.value = clamp((Number.isFinite(feedbackPct) ? feedbackPct : 18) / 100, 0, 0.4);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(Number.isFinite(lowpassHz) ? lowpassHz : 4200, 1200, 10000);
  filter.Q.value = 0.7;

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 280;

  input.connect(delay);
  delay.connect(filter);
  filter.connect(hpf);
  hpf.connect(feedback);
  feedback.connect(delay);

  return {
    input,
    output: hpf,
    nodes: [input, delay, feedback, filter, hpf],
    sendLevel: 0.18,
  };
}

function buildReverb(ctx, visual) {
  const preDelayMs = Number(visual.preDelayMs);
  const size = String(visual.size || "").toLowerCase();

  const input = ctx.createGain();
  const pre = ctx.createDelay(0.25);
  pre.delayTime.value = clamp((Number.isFinite(preDelayMs) ? preDelayMs : 28) / 1000, 0, 0.12);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, size);

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 350;

  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 6500;

  const wet = ctx.createGain();
  wet.gain.value = 1;

  input.connect(pre);
  pre.connect(convolver);
  convolver.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(wet);

  return {
    input,
    output: wet,
    nodes: [input, pre, convolver, hpf, lpf, wet],
    sendLevel: size.includes("hall") || size.includes("large") ? 0.12 : 0.15,
  };
}

function buildDeesser(ctx, visual) {
  const freq = clamp(Number(visual.freq) || 6500, 4000, 11000);
  const reduction = clamp(Number(visual.reductionDb) || 3, 0, 8);

  const filter = ctx.createBiquadFilter();
  filter.type = "peaking";
  filter.frequency.value = freq;
  filter.Q.value = 1.8;
  filter.gain.value = -Math.min(reduction * 0.4, 3.5);

  return { input: filter, output: filter, nodes: [filter] };
}

function buildSaturator(ctx, visual) {
  const driveLabel = String(visual.drive || "low").toLowerCase();
  let amount = 0.06;
  if (driveLabel.includes("high") || driveLabel.includes("hot")) amount = 0.16;
  else if (driveLabel.includes("med")) amount = 0.1;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSaturationCurve(amount);
  shaper.oversample = "2x";

  const makeup = ctx.createGain();
  makeup.gain.value = 0.96;

  shaper.connect(makeup);
  return { input: shaper, output: makeup, nodes: [shaper, makeup] };
}

function buildModulation(ctx, visual, placement) {
  const input = ctx.createGain();
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = 0.014;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = String(visual.rate || "").includes("fast") ? 1.2 : 0.3;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.0025;
  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  const wet = ctx.createGain();
  wet.gain.value = placement === "send" ? 1 : 0.22;
  const dry = ctx.createGain();
  dry.gain.value = placement === "send" ? 0 : 0.85;
  const out = ctx.createGain();

  input.connect(delay);
  delay.connect(wet);
  wet.connect(out);
  input.connect(dry);
  dry.connect(out);

  return {
    input,
    output: out,
    nodes: [input, delay, lfo, lfoGain, wet, dry, out],
    sendLevel: 0.12,
  };
}

function makeImpulse(ctx, sizeLabel) {
  const sr = ctx.sampleRate;
  let seconds = 0.4;
  if (sizeLabel.includes("hall") || sizeLabel.includes("large") || sizeLabel.includes("ambient")) {
    seconds = 0.95;
  } else if (sizeLabel.includes("room") || sizeLabel.includes("chamber")) {
    seconds = 0.55;
  } else if (sizeLabel.includes("plate") || sizeLabel.includes("short")) {
    seconds = 0.32;
  }

  const length = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Faster decay + softer noise = less wash on vocals
      const decay = Math.pow(1 - t, 2.8) * (1 - t * 0.35);
      data[i] = (Math.random() * 2 - 1) * decay * (ch === 0 ? 0.55 : 0.5);
    }
  }
  return buffer;
}

function makeSaturationCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  const k = 1 + amount * 5;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function parseDelayMs(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  const s = String(time || "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*ms/i);
  if (m) return Number(m[1]);
  if (/dotted/i.test(s) && /1\/8/.test(s)) return 375;
  if (/1\/8/i.test(s)) return 250;
  if (/1\/4/i.test(s)) return 500;
  if (/1\/16/i.test(s)) return 125;
  return null;
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
