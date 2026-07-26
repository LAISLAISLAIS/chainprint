/**
 * Hero / analyzing chain mark — horizontal 5-link lockup.
 * Cycle variant uses HTML + CSS color animation (SVG stroke loops were freezing in browsers).
 * @param {HTMLElement | null} root
 * @param {{ variant?: 'hero' | 'cycle' }} [opts]
 */
export function mountChainMark(root, opts = {}) {
  if (!root) return () => {};

  const variant = opts.variant || "hero";
  root.classList.add("logo-hero");
  if (variant === "cycle") root.classList.add("logo-hero--cycle");

  if (variant === "cycle") {
    // Pure CSS infinite loop — no rAF, no SVG stroke paint (those were getting stuck)
    root.innerHTML = `
      <div class="chain-flow" aria-hidden="true">
        <span class="chain-flow-link chain-flow-link--v" style="--i:0"></span>
        <span class="chain-flow-link chain-flow-link--h" style="--i:1"></span>
        <span class="chain-flow-link chain-flow-link--v" style="--i:2"></span>
        <span class="chain-flow-link chain-flow-link--h" style="--i:3"></span>
        <span class="chain-flow-link chain-flow-link--v" style="--i:4"></span>
      </div>
    `;
  } else {
    root.innerHTML = `
      <svg class="chain-mark-svg" viewBox="0 0 120 40" aria-hidden="true">
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
  }

  return () => {
    root.classList.remove("logo-hero", "logo-hero--cycle");
    root.innerHTML = "";
  };
}
