/**
 * Hero / analyzing chain mark — horizontal 5-link lockup.
 * Both variants use HTML + CSS (SVG stroke loops were freezing in browsers).
 * - hero: white/gray pulse for the landing page
 * - cycle: teal pulse for analyzing / Key·BPM busy
 * @param {HTMLElement | null} root
 * @param {{ variant?: 'hero' | 'cycle' }} [opts]
 */
export function mountChainMark(root, opts = {}) {
  if (!root) return () => {};

  const variant = opts.variant || "hero";
  root.classList.add("logo-hero");
  if (variant === "cycle") root.classList.add("logo-hero--cycle");
  else root.classList.add("logo-hero--pulse");

  // Pure CSS infinite loop — no rAF, no SVG stroke paint
  root.innerHTML = `
    <div class="chain-flow" aria-hidden="true">
      <span class="chain-flow-link chain-flow-link--v" style="--i:0"></span>
      <span class="chain-flow-link chain-flow-link--h" style="--i:1"></span>
      <span class="chain-flow-link chain-flow-link--v" style="--i:2"></span>
      <span class="chain-flow-link chain-flow-link--h" style="--i:3"></span>
      <span class="chain-flow-link chain-flow-link--v" style="--i:4"></span>
    </div>
  `;

  return () => {
    root.classList.remove("logo-hero", "logo-hero--cycle", "logo-hero--pulse");
    root.innerHTML = "";
  };
}
