/**
 * Build a Web Audio approximation of a Chainprint chain from step.visual params.
 */

/**
 * @typedef {{ input: AudioNode, output: AudioNode, dispose: () => void }} ChainFxGraph
 */

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

  for (const step of inserts) {
    const built = buildStepNodes(ctx, step?.visual, "insert");
    if (!built) continue;
    cursor.connect(built.input);
    cursor = built.output;
    nodes.push(...built.nodes);
  }

  // Split: dry insert path continues; sends are parallel wet returns blended in
  const insertOut = ctx.createGain();
  insertOut.gain.value = 1;
  cursor.connect(insertOut);
  nodes.push(insertOut);

  const mix = ctx.createGain();
  mix.gain.value = 1;
  insertOut.connect(mix);
  nodes.push(mix);

  for (const step of sends) {
    const built = buildStepNodes(ctx, step?.visual, "send");
    if (!built) continue;
    const sendGain = ctx.createGain();
    // Keep sends subtle so the preview doesn't wash out the lead
    sendGain.gain.value = typeof built.sendLevel === "number" ? built.sendLevel : 0.28;
    insertOut.connect(sendGain);
    sendGain.connect(built.input);
    built.output.connect(mix);
    nodes.push(sendGain, ...built.nodes);
  }

  const output = ctx.createGain();
  output.gain.value = 0.92; // slight headroom after FX stack
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
      return buildWidth(ctx, visual);
    case "modulation":
      return buildModulation(ctx, visual);
    case "imaging":
      return buildWidth(ctx, { mode: "fx_wide" });
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
  // Peak targets are instructional; apply a gentle trim so later stages have headroom
  const headroom = Number(visual.headroomDb);
  const trim = Number.isFinite(headroom) ? Math.min(0, -Math.min(6, headroom) * 0.15) : -0.5;
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
      filter.gain.value = clamp(Number(band.gain) || 0, -18, 18);
    }
    if (filter.type === "peaking" || filter.type === "lowpass" || filter.type === "highpass") {
      const q = Number(band.q);
      filter.Q.value = Number.isFinite(q) && q > 0 ? clamp(q, 0.1, 18) : type === "hpf" ? 0.7 : 1;
    }
    // Approximate steep HPF slope with higher Q on first order (Web Audio is 12dB/oct)
    if ((type === "hpf" || type === "highpass") && Number(band.slope) >= 24) {
      filter.Q.value = 0.9;
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
    isLimiter ? Math.max(12, ratio || 20) : Number.isFinite(ratio) ? ratio : 3,
    1,
    20
  );
  comp.attack.value = clamp((Number.isFinite(attackMs) ? attackMs : isLimiter ? 1 : 15) / 1000, 0, 1);
  comp.release.value = clamp((Number.isFinite(releaseMs) ? releaseMs : 80) / 1000, 0.01, 1);
  comp.knee.value = visual.knee === "hard" || isLimiter ? 3 : 12;

  // Heuristic threshold: more GR target → lower threshold
  const targetGr = Number.isFinite(grDb) ? grDb : isLimiter ? 2 : 4;
  comp.threshold.value = clamp(isLimiter ? -6 - targetGr : -18 - targetGr * 1.5, -60, 0);

  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(Math.min(targetGr * 0.55, isLimiter ? 2 : 5));

  comp.connect(makeup);
  return { input: comp, output: makeup, nodes: [comp, makeup] };
}

function buildDelay(ctx, visual) {
  const delayMs = parseDelayMs(visual.time) ?? 280;
  const feedbackPct = Number(visual.feedbackPct);
  const lowpassHz = Number(visual.lowpassHz);

  const input = ctx.createGain();
  const delay = ctx.createDelay(Math.min(2, delayMs / 1000 + 0.05));
  delay.delayTime.value = clamp(delayMs / 1000, 0.02, 1.8);

  const feedback = ctx.createGain();
  feedback.gain.value = clamp((Number.isFinite(feedbackPct) ? feedbackPct : 20) / 100, 0, 0.55);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(Number.isFinite(lowpassHz) ? lowpassHz : 4500, 800, 16000);
  filter.Q.value = 0.7;

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 220;

  input.connect(delay);
  delay.connect(filter);
  filter.connect(hpf);
  hpf.connect(feedback);
  feedback.connect(delay);

  return {
    input,
    output: hpf,
    nodes: [input, delay, feedback, filter, hpf],
    sendLevel: 0.32,
  };
}

function buildReverb(ctx, visual) {
  const preDelayMs = Number(visual.preDelayMs);
  const size = String(visual.size || "").toLowerCase();

  const input = ctx.createGain();
  const pre = ctx.createDelay(0.25);
  pre.delayTime.value = clamp((Number.isFinite(preDelayMs) ? preDelayMs : 40) / 1000, 0, 0.2);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, size);

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 280;

  const wet = ctx.createGain();
  wet.gain.value = 1;

  input.connect(pre);
  pre.connect(convolver);
  convolver.connect(hpf);
  hpf.connect(wet);

  return {
    input,
    output: wet,
    nodes: [input, pre, convolver, hpf, wet],
    sendLevel: size.includes("hall") || size.includes("large") ? 0.22 : 0.26,
  };
}

function buildDeesser(ctx, visual) {
  // Light static HF cut as approximation (true de-ess needs dynamics)
  const freq = clamp(Number(visual.freq) || 6500, 3000, 12000);
  const reduction = clamp(Number(visual.reductionDb) || 3, 0, 12);

  const filter = ctx.createBiquadFilter();
  filter.type = "peaking";
  filter.frequency.value = freq;
  filter.Q.value = 2.2;
  filter.gain.value = -Math.min(reduction * 0.55, 5);

  return { input: filter, output: filter, nodes: [filter] };
}

function buildSaturator(ctx, visual) {
  const driveLabel = String(visual.drive || "low").toLowerCase();
  let amount = 0.12;
  if (driveLabel.includes("high") || driveLabel.includes("hot")) amount = 0.35;
  else if (driveLabel.includes("med")) amount = 0.22;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSaturationCurve(amount);
  shaper.oversample = "2x";

  const makeup = ctx.createGain();
  makeup.gain.value = 0.92;

  shaper.connect(makeup);
  return { input: shaper, output: makeup, nodes: [shaper, makeup] };
}

function buildWidth(ctx, visual) {
  // Mid-side-ish width via channel splitter (center mode ≈ mono-ish mild)
  const mode = String(visual.mode || "center");
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const midL = ctx.createGain();
  const midR = ctx.createGain();
  const sideL = ctx.createGain();
  const sideR = ctx.createGain();

  const width = mode === "center" ? 0.15 : 0.55;
  midL.gain.value = 1 - width * 0.35;
  midR.gain.value = 1 - width * 0.35;
  sideL.gain.value = width;
  sideR.gain.value = width;

  splitter.connect(midL, 0);
  splitter.connect(midR, 1);
  splitter.connect(sideL, 0);
  splitter.connect(sideR, 1);
  // Cross-feed for width illusion
  midL.connect(merger, 0, 0);
  midR.connect(merger, 0, 1);
  sideL.connect(merger, 0, 1);
  sideR.connect(merger, 0, 0);

  return {
    input: splitter,
    output: merger,
    nodes: [splitter, merger, midL, midR, sideL, sideR],
  };
}

function buildModulation(ctx, visual) {
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = 0.018;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = String(visual.rate || "").includes("fast") ? 1.8 : 0.35;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.004;
  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  delay.connect(wet);

  return {
    input: delay,
    output: wet,
    nodes: [delay, lfo, lfoGain, wet],
    sendLevel: 0.18,
  };
}

function makeImpulse(ctx, sizeLabel) {
  const sr = ctx.sampleRate;
  let seconds = 0.55;
  if (sizeLabel.includes("hall") || sizeLabel.includes("large") || sizeLabel.includes("ambient")) {
    seconds = 1.4;
  } else if (sizeLabel.includes("room") || sizeLabel.includes("chamber")) {
    seconds = 0.85;
  } else if (sizeLabel.includes("plate") || sizeLabel.includes("short")) {
    seconds = 0.45;
  }

  const length = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const decay = Math.pow(1 - t, 2.2);
      data[i] = (Math.random() * 2 - 1) * decay * (ch === 0 ? 1 : 0.92);
    }
  }
  return buffer;
}

function makeSaturationCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  const k = 1 + amount * 8;
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
  if (/dotted\s*1\/8/i.test(s)) return 375;
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
