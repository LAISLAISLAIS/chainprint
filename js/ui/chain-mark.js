/**
 * Hero / analyzing chain mark — horizontal 5-link lockup.
 * Cycle variant: JS-driven teal palette flow (CSS stroke animation is unreliable on SVG).
 * @param {HTMLElement | null} root
 * @param {{ variant?: 'hero' | 'cycle' }} [opts]
 */
export function mountChainMark(root, opts = {}) {
  if (!root) return () => {};

  const variant = opts.variant || "hero";
  root.classList.add("logo-hero");
  if (variant === "cycle") root.classList.add("logo-hero--cycle");

  const uid = `cp-chain-${Math.random().toString(36).slice(2, 9)}`;

  root.innerHTML = `
    <svg class="chain-mark-svg" viewBox="0 0 120 40" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="120" y2="20">
          <stop class="chain-grad-a" offset="0%" stop-color="#2f6f66"/>
          <stop class="chain-grad-b" offset="35%" stop-color="#6ec4b4"/>
          <stop class="chain-grad-c" offset="65%" stop-color="#d4f6ef"/>
          <stop class="chain-grad-d" offset="100%" stop-color="#3f8f84"/>
        </linearGradient>
      </defs>
      <g class="chain-compose" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <g class="chain-link chain-link--1">
          <rect class="chain-stroke" x="10" y="6" width="14" height="28" rx="7"/>
        </g>
        <g class="chain-link chain-link--2">
          <rect class="chain-stroke chain-stroke--mid" x="18" y="13" width="42" height="14" rx="7"/>
        </g>
        <g class="chain-link chain-link--3">
          <rect class="chain-stroke" x="54" y="6" width="14" height="28" rx="7"/>
        </g>
        <g class="chain-link chain-link--4">
          <rect class="chain-stroke" x="62" y="13" width="42" height="14" rx="7"/>
        </g>
        <g class="chain-link chain-link--5">
          <rect class="chain-stroke" x="96" y="6" width="14" height="28" rx="7"/>
        </g>
      </g>
    </svg>
  `;

  /** @type {(() => void) | null} */
  let stopCycle = null;
  if (variant === "cycle") {
    stopCycle = startPaletteCycle(root, uid);
  }

  return () => {
    stopCycle?.();
    stopCycle = null;
    root.classList.remove("logo-hero", "logo-hero--cycle");
    root.innerHTML = "";
  };
}

/** Teal-family stops — deep → bright mint → deep (visible change, no rainbow) */
const PALETTE = [
  [47, 111, 102], // #2f6f66
  [63, 143, 132], // #3f8f84
  [110, 196, 180], // #6ec4b4
  [142, 217, 203], // #8ed9cb
  [212, 246, 239], // #d4f6ef
  [142, 217, 203],
  [110, 196, 180],
  [63, 143, 132],
];

/**
 * @param {number} t 0..1
 * @returns {string}
 */
function samplePalette(t) {
  const n = PALETTE.length;
  const x = ((t % 1) + 1) % 1;
  const f = x * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const u = f - Math.floor(f);
  const a = PALETTE[i];
  const b = PALETTE[j];
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * @param {HTMLElement} root
 * @param {string} gradId
 */
function startPaletteCycle(root, gradId) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const strokes = /** @type {SVGElement[]} */ ([...root.querySelectorAll(".chain-stroke")]);
  const stops = /** @type {SVGStopElement[]} */ ([...root.querySelectorAll(`#${CSS.escape(gradId)} stop`)]);
  const compose = root.querySelector(".chain-compose");

  const paintStatic = () => {
    const c = "#6ec4b4";
    for (const el of strokes) {
      el.setAttribute("stroke", c);
      el.setAttribute("opacity", "0.92");
    }
    for (const stop of stops) stop.setAttribute("stop-color", c);
  };

  if (reduced || !strokes.length) {
    paintStatic();
    return () => {};
  }

  // Gradient stroke reads as a flowing band across the chain
  for (const el of strokes) {
    el.setAttribute("stroke", `url(#${gradId})`);
    el.setAttribute("opacity", "0.95");
  }

  let raf = 0;
  let running = false;
  let t0 = performance.now();
  let onScreen = true;

  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000;
    // Full palette lap ~2.8s — clearly visible while analyzing
    const speed = 0.36;

    if (stops.length >= 4) {
      stops[0].setAttribute("stop-color", samplePalette(t * speed));
      stops[1].setAttribute("stop-color", samplePalette(t * speed + 0.22));
      stops[2].setAttribute("stop-color", samplePalette(t * speed + 0.48));
      stops[3].setAttribute("stop-color", samplePalette(t * speed + 0.72));
    }

    // Per-link opacity wave so motion reads even if gradient is subtle
    strokes.forEach((el, i) => {
      const wave = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * speed + i * 0.9));
      el.setAttribute("opacity", wave.toFixed(3));
    });

    if (compose instanceof SVGElement) {
      const s = 1 + 0.025 * Math.sin(t * Math.PI * 2 * 0.32);
      compose.setAttribute("transform", `translate(60 20) scale(${s.toFixed(4)}) translate(-60 -20)`);
    }

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || document.hidden || !onScreen) return;
    running = true;
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  document.addEventListener("visibilitychange", onVisibility);

  /** @type {IntersectionObserver | null} */
  let io = null;
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.02);
        if (onScreen) start();
        else stop();
      },
      { threshold: [0, 0.02, 0.2] }
    );
    io.observe(root);
  }

  start();

  return () => {
    stop();
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
