/**
 * Render a branded multi-page PDF of the full reference analysis and download it.
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
 * Slice a tall canvas into letter pages (portrait).
 * @param {import("jspdf").jsPDF} pdf
 * @param {HTMLCanvasElement} canvas
 */
function addPaginatedCanvas(pdf, canvas) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 22;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const imgW = canvas.width;
  const imgH = canvas.height;
  const scale = maxW / imgW;
  const pageSlicePx = Math.floor(maxH / scale);

  let srcY = 0;
  let pageIndex = 0;

  while (srcY < imgH) {
    const sliceH = Math.min(pageSlicePx, imgH - srcY);
    if (sliceH <= 0) break;

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = imgW;
    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not page the PDF canvas.");
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, imgW, sliceH);
    ctx.drawImage(canvas, 0, srcY, imgW, sliceH, 0, 0, imgW, sliceH);

    const drawW = maxW;
    const drawH = sliceH * scale;
    const x = margin;
    const y = margin;

    if (pageIndex > 0) pdf.addPage();
    pdf.setFillColor(5, 5, 5);
    pdf.rect(0, 0, pageW, pageH, "F");
    pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", x, y, drawW, drawH, undefined, "FAST");

    srcY += sliceH;
    pageIndex += 1;

    // Safety — avoid runaway if something goes wrong with heights
    if (pageIndex > 40) break;
  }
}

/**
 * @param {{ chain: object }} advice
 * @param {{ trackName?: string, keyLabel?: string, bpm?: number|string, readout?: object, traits?: object }} [meta]
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
  } else {
    style.textContent = EXPORT_SHEET_CSS;
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
    height: sheet.scrollHeight || sheet.offsetHeight,
    windowWidth: sheet.offsetWidth,
    windowHeight: sheet.scrollHeight || sheet.offsetHeight,
  });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  addPaginatedCanvas(pdf, canvas);

  const target = advice.target || "vocal";
  const name = slug(meta.trackName) || target;
  pdf.save(`chainprint-analysis-${target}-${name}.pdf`);

  mount.innerHTML = "";
}
