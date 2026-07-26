/**
 * Render a branded one-page PDF of the vocal chain and download it.
 */

import { buildExportSheetHtml, EXPORT_SHEET_CSS } from "./chain-sheet.js";

function slug(s) {
  return String(s || "chain")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function loadPdfLibs() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
    import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm"),
  ]);
  return { html2canvas, jsPDF };
}

/**
 * @param {{ chain: object }} advice
 * @param {{ trackName?: string, keyLabel?: string, bpm?: number|string }} [meta]
 */
export async function downloadChainPdf(advice, meta = {}) {
  const { html2canvas, jsPDF } = await loadPdfLibs();

  let mount = document.querySelector("[data-export-mount]");
  if (!mount) {
    mount = document.createElement("div");
    mount.className = "xp-mount";
    mount.setAttribute("data-export-mount", "");
    document.body.appendChild(mount);
  }

  let style = document.querySelector("[data-export-style]");
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-export-style", "");
    style.textContent = EXPORT_SHEET_CSS;
    document.head.appendChild(style);
  }

  mount.innerHTML = buildExportSheetHtml(advice, meta);
  const sheet = mount.querySelector("[data-export-sheet]");
  if (!sheet) throw new Error("Export sheet failed to render.");

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }
  // Let layout settle after fonts
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const canvas = await html2canvas(sheet, {
    backgroundColor: "#050505",
    scale: 2,
    useCORS: true,
    logging: false,
    width: sheet.offsetWidth,
    height: sheet.offsetHeight,
    onclone: (_doc, el) => {
      // Keep SVG type pills crisp; avoid CSS text metrics html2canvas mangling
      el.querySelectorAll("svg.xp-type").forEach((node) => {
        node.setAttribute("shape-rendering", "geometricPrecision");
        node.style.display = "block";
        node.style.transform = "none";
      });
    },
  });

  // Landscape letter — one page, fill width
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const imgW = canvas.width;
  const imgH = canvas.height;
  const scale = Math.min(maxW / imgW, maxH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  const img = canvas.toDataURL("image/png");
  pdf.setFillColor(5, 5, 5);
  pdf.rect(0, 0, pageW, pageH, "F");
  pdf.addImage(img, "PNG", x, y, drawW, drawH, undefined, "FAST");

  const daw = advice.chain?.daw || "daw";
  const target = advice.target || "vocal";
  const name = slug(meta.trackName) || target;
  pdf.save(`chainprint-${target}-${name}.pdf`);

  mount.innerHTML = "";
}
