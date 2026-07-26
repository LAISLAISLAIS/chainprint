/**
 * Hero / analyzing chain mark — horizontal 5-link lockup.
 * Cycle variant: teal palette flow via CSS currentColor + JS stroke paint (belt & suspenders).
 * @param {HTMLElement | null} root
 * @param {{ variant?: 'hero' | 'cycle' }} [opts]
 */
export function mountChainMark(root, opts = {}) {
  if (!root) return () => {};

  const variant = opts.variant || "hero";
  root.classList.add("logo-hero");
  if (variant === "cycle") root.classList.add("logo-hero--cycle");

  root.innerHTML = `
    <svg class="chain-mark-svg" viewBox="0 0 120 40" aria-hidden="true">
      <g class="chain-compose" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <g class="chain-link chain-link--1">
          <rect class="chain-stroke" x="10" y="6" width="14" height="28" rx="7" stroke="currentColor"/>
        </g>
        <g class="chain-link chain-link--2">
          <rect class="chain-stroke chain-stroke--mid" x="18" y="13" width="42" height="14" rx="7" stroke="currentColor"/>
        </g>
        <g class="chain-link chain-link--3">
          <rect class="chain-stroke" x="54" y="6" width="14" height="28" rx="7" stroke="currentColor"/>
        </g>
        <g class="chain-link chain-link--4">
          <rect class="chain-stroke" x="62" y="13" width="42" height="14" rx="7" stroke="currentColor"/>
        </g>
        <g class="chain-link chain-link--5">
          <rect class="chain-stroke" x="96" y="6" width="14" height="28" rx="7" stroke="currentColor"/>
        </g>
      </g>
    </svg>
  `;

  /** @type {(() => void) | null} */
  let stopCycle = null;
  if (variant === "cycle") {
    stopCycle = startPaletteCycle(root);
  }

  return () => {
    stopCycle?.();
    stopCycle = null;
    root.classList.remove("logo-hero", "logo-hero--cycle");
    root.innerHTML = "";
  };
}

/** Deep teal → bright mint — high contrast so the loop is obvious */
const PALETTE = [
  [36, 92, 85], // #245c55
  [63, 143, 132], // #3f8f84
  [110, 196, 180], // #6ec4b4
  [180, 235, 224], // #b4ebe0
  [232, 255, 250], // #e8fffa
  [180, 235, 224],
  [110, 196, 180],
  [63, 143, 132],
];

/**
 * @param {number} t
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
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)}, ${Math.round(a[1] + (b[1] - a[1]) * u)}, ${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

/**
 * Keep painting solid per-link colors every frame.
 * No IntersectionObserver (it was stopping the loop after first layout).
 * @param {HTMLElement} root
 */
function startPaletteCycle(root) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const links = /** @type {SVGGElement[]} */ ([...root.querySelectorAll(".chain-link")]);
  const strokes = /** @type {SVGElement[]} */ ([...root.querySelectorAll(".chain-stroke")]);
  const compose = root.querySelector(".chain-compose");

  if (reduced || !strokes.length) {
    const c = "#6ec4b4";
    for (const el of strokes) {
      el.setAttribute("stroke", c);
      el.style.stroke = c;
      el.setAttribute("opacity", "0.92");
    }
    return () => {};
  }

  let raf = 0;
  let running = false;
  let t0 = performance.now();

  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000;
    // ~1.6s full palette lap
    const speed = 0.62;

    links.forEach((link, i) => {
      const color = samplePalette(t * speed + i * 0.14);
      link.style.color = color;
      const stroke = strokes[i];
      if (stroke) {
        stroke.setAttribute("stroke", color);
        stroke.style.stroke = color;
        const wave = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * speed * 1.15 + i * 0.85));
        stroke.setAttribute("opacity", wave.toFixed(3));
        stroke.style.opacity = String(wave);
      }
    });

    if (compose instanceof SVGElement) {
      const s = 1 + 0.035 * Math.sin(t * Math.PI * 2 * 0.45);
      compose.setAttribute("transform", `translate(60 20) scale(${s.toFixed(4)}) translate(-60 -20)`);
    }

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || document.hidden) return;
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
  // Defer one frame so layout is ready, then run until unmounted
  requestAnimationFrame(() => start());

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
