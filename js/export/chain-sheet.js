/**
 * Build a printable / PDF-ready HTML sheet for a vocal chain.
 * Black & white Chainprint brand, dense one-page layout.
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stepLines(step) {
  if (step.copy?.length) return step.copy;
  if (step.dials?.length) return step.dials.map((d) => `${d.label}: ${d.value}`);
  return [];
}

function stepCard(step, index, kind) {
  const n = kind === "send" ? `S${index + 1}` : String(index + 1).padStart(2, "0");
  const lines = stepLines(step)
    .slice(0, 4)
    .map((line) => `<li>${esc(line)}</li>`)
    .join("");

  return `
    <article class="xp-step">
      <div class="xp-step-head">
        <span class="xp-n">${n}</span>
        <div class="xp-step-titles">
          <h3>${esc(step.title)}</h3>
          <p>${esc(step.plugin)}</p>
        </div>
        <span class="xp-type"><span class="xp-type-text">${esc(step.type || (kind === "send" ? "Send" : "Insert"))}</span></span>
      </div>
      ${lines ? `<ul class="xp-lines">${lines}</ul>` : ""}
    </article>`;
}

/** White chain mark matching site logo silhouette — img is reliable in html2canvas */
const MARK_IMG_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" fill="none"><g stroke="#f2f2f2" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" fill="none"><rect x="10" y="6" width="14" height="28" rx="7"/><rect x="18" y="13" width="42" height="14" rx="7"/><rect x="54" y="6" width="14" height="28" rx="7"/><rect x="62" y="13" width="42" height="14" rx="7"/><rect x="96" y="6" width="14" height="28" rx="7"/></g></svg>`
  );

/**
 * @param {{ chain: object, honesty?: string, mode?: string }} advice
 * @param {{ trackName?: string, generatedAt?: Date }} [meta]
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
  const modeLabel = advice.mode === "deep" ? "Pro / Deep" : "Standard";

  const inserts = (chain.inserts || [])
    .map((s, i) => stepCard(s, i, "insert"))
    .join("");
  const sends = (chain.sends || [])
    .map((s, i) => stepCard(s, i, "send"))
    .join("");

  return `
    <div class="xp-sheet" data-export-sheet>
      <header class="xp-top">
        <div class="xp-brand">
          <img class="xp-mark" src="${MARK_IMG_URI}" width="56" height="19" alt="" />
          <span class="xp-word">Chainprint</span>
        </div>
        <div class="xp-meta">
          <p class="xp-doc">Vocal chain</p>
          <p class="xp-sub">${esc(modeLabel)} · ${esc(track)} · ${esc(when)}</p>
        </div>
      </header>

      <p class="xp-lede">Open each processor in order. Set the values below — then A/B against your reference.</p>

      <div class="xp-columns">
        <section class="xp-col">
          <h2>Inserts</h2>
          <div class="xp-stack">${inserts}</div>
        </section>
        <section class="xp-col">
          <h2>Sends</h2>
          <div class="xp-stack">${sends}</div>
        </section>
      </div>

      <footer class="xp-foot">
        <span>chainprint.app</span>
        <span>Engineered recreation from the measured vocal signature — refine by ear in full mix context.</span>
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
    width: 1100px;
    min-height: 714px;
    padding: 36px 40px 28px;
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

  /* Chain mark — same geometry as site / assets/mark.svg */
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
    line-height: 1.35;
  }

  .xp-lede {
    margin: 14px 0 18px;
    font-size: 12px;
    color: #9a9a9a;
    letter-spacing: -0.01em;
    line-height: 1.4;
  }

  .xp-columns {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    gap: 22px;
    align-items: start;
  }

  .xp-col h2 {
    margin: 0 0 10px;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6a6a6a;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 9px;
    border-radius: 999px;
    background: #f0f0f0;
    color: #0a0a0a;
    white-space: nowrap;
    align-self: start;
  }

  .xp-type-text {
    display: block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    line-height: 1;
    /* Optical center: letter-spacing adds trailing space */
    padding-left: 0.05em;
    transform: translateY(0.5px);
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

  .xp-foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    margin-top: 18px;
    padding-top: 12px;
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
