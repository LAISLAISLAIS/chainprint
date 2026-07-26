/**
 * Render a branded multi-page PDF of the full reference analysis and download it.
 * Pages are packed from atomic blocks so cards are never sliced mid-element.
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

/** Letter page at 96dpi CSS px for 816px content width */
const PAGE_WIDTH_PX = 816;
const PAGE_HEIGHT_PX = Math.round(PAGE_WIDTH_PX * (11 / 8.5)); // 1056
const PAGE_PAD_Y = 36;
const PAGE_CONTENT_H = PAGE_HEIGHT_PX - PAGE_PAD_Y * 2;
const BLOCK_GAP = 14;

/**
 * Move [data-xp-keep] blocks into fixed-height .xp-page shells.
 * @param {HTMLElement} sheet
 * @returns {HTMLElement[]}
 */
function packIntoPages(sheet) {
  const blocks = [...sheet.querySelectorAll("[data-xp-keep]")];
  if (!blocks.length) {
    sheet.classList.add("xp-page");
    sheet.setAttribute("data-export-page", "");
    return [sheet];
  }

  const measured = blocks.map((el) => ({
    el,
    height: Math.ceil(el.getBoundingClientRect().height),
  }));

  /** @type {HTMLElement[][]} */
  const groups = [];
  /** @type {HTMLElement[]} */
  let current = [];
  let used = 0;

  for (const block of measured) {
    const h = Math.max(block.height, 1);

    if (current.length) {
      const nextUsed = used + BLOCK_GAP + h;
      if (nextUsed > PAGE_CONTENT_H) {
        groups.push(current);
        current = [];
        used = 0;
      }
    }

    if (!current.length && h > PAGE_CONTENT_H) {
      groups.push([block.el]);
      continue;
    }

    current.push(block.el);
    used += (current.length === 1 ? 0 : BLOCK_GAP) + h;
  }
  if (current.length) groups.push(current);

  const host = document.createElement("div");
  host.className = "xp-pages";
  host.setAttribute("data-export-pages", "");

  for (const group of groups) {
    const page = document.createElement("div");
    page.className = "xp-page";
    page.setAttribute("data-export-page", "");
    for (const el of group) page.appendChild(el);
    host.appendChild(page);
  }

  sheet.replaceWith(host);
  return [...host.querySelectorAll("[data-export-page]")];
}

/**
 * @param {import("jspdf").jsPDF} pdf
 * @param {HTMLCanvasElement} canvas
 * @param {boolean} first
 */
function addFullPageCanvas(pdf, canvas, first) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  if (!first) pdf.addPage();
  pdf.setFillColor(5, 5, 5);
  pdf.rect(0, 0, pageW, pageH, "F");

  // Fill the letter page edge-to-edge (page shell already has padding)
  const imgW = canvas.width;
  const imgH = canvas.height;
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, drawW, drawH, undefined, "FAST");
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
    document.head.appendChild(style);
  }
  style.textContent = EXPORT_SHEET_CSS;

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
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const pages = packIntoPages(sheet);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = await html2canvas(page, {
      backgroundColor: "#050505",
      scale: 2,
      useCORS: true,
      logging: false,
      width: page.offsetWidth || PAGE_WIDTH_PX,
      height: page.offsetHeight || PAGE_HEIGHT_PX,
      windowWidth: page.offsetWidth || PAGE_WIDTH_PX,
      windowHeight: page.offsetHeight || PAGE_HEIGHT_PX,
    });
    addFullPageCanvas(pdf, canvas, i === 0);
  }

  const target = advice.target || "vocal";
  const name = slug(meta.trackName) || target;
  pdf.save(`chainprint-analysis-${target}-${name}.pdf`);

  mount.innerHTML = "";
}
