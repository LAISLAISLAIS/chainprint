/* Headless mobile audit: player dock visibility, animations, scroll blockers. */
import { chromium } from "playwright";
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wav": "audio/wav",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(ROOT, p);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("nope");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(`${base}/analyze/`, { waitUntil: "networkidle" });

// Generate a small WAV in-page and feed it through the dropzone input
const report1 = await page.evaluate(async () => {
  function makeWav(seconds = 2, rate = 22050) {
    const n = seconds * rate;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data");
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const s = Math.sin(2 * Math.PI * 220 * t) * 0.4 + Math.sin(2 * Math.PI * 330 * t) * 0.2;
      v.setInt16(44 + i * 2, s * 32767, true);
    }
    return new File([buf], "test-tone.wav", { type: "audio/wav" });
  }
  const dock = document.querySelector("[data-playback-dock]");
  const out = {
    dockMounted: Boolean(dock),
    dockStyles: null,
    bodyOverflow: getComputedStyle(document.body).overflow,
  };
  if (dock) {
    const cs = getComputedStyle(dock);
    out.dockStyles = {
      position: cs.position,
      opacity: cs.opacity,
      transform: cs.transform,
      zIndex: cs.zIndex,
      display: cs.display,
      bottom: cs.bottom,
      width: cs.width,
    };
  }
  window.__wav = makeWav();
  return out;
});
console.log("== analyze initial ==", JSON.stringify(report1, null, 2));

// Try playing directly through the audio-player module
const playReport = await page.evaluate(async () => {
  const mod = await import("/js/ui/audio-player.js");
  try {
    await mod.playAudio(window.__wav, "test", { title: "Test tone" });
  } catch (e) {
    return { playError: String(e) };
  }
  await new Promise((r) => setTimeout(r, 400));
  const dock = document.querySelector("[data-playback-dock]");
  const rect = dock?.getBoundingClientRect();
  const cs = dock ? getComputedStyle(dock) : null;
  return {
    isLive: dock?.classList.contains("is-live"),
    rect: rect ? { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width } : null,
    viewportH: window.innerHeight,
    opacity: cs?.opacity,
    transform: cs?.transform,
    visible: rect ? rect.top < window.innerHeight && rect.bottom > 0 : false,
    coveredBy: (() => {
      if (!rect) return null;
      const el = document.elementFromPoint(window.innerWidth / 2, rect.top + rect.height / 2);
      return el ? `${el.tagName}.${el.className}`.slice(0, 90) : null;
    })(),
  };
});
console.log("== analyze after play ==", JSON.stringify(playReport, null, 2));
await page.screenshot({ path: "/tmp/analyze-mobile-play.png" });

// Animation audit: check running animations on chain mark when analyzing
const findPage = await ctx.newPage();
findPage.on("pageerror", (e) => errors.push(`find pageerror: ${e.message}`));
await findPage.goto(`${base}/find/`, { waitUntil: "networkidle" });
const findReport = await findPage.evaluate(async () => {
  const { mountChainMark } = await import("/js/ui/chain-mark.js");
  const drop = document.querySelector("[data-dropzone]");
  drop.classList.add("is-busy");
  const markRoot = document.querySelector("[data-find-mark]");
  mountChainMark(markRoot, { variant: "cycle" });
  await new Promise((r) => setTimeout(r, 300));
  const link = markRoot.querySelector(".chain-flow-link");
  const rect = link?.getBoundingClientRect();
  const rootRect = markRoot.getBoundingClientRect();
  const anims = markRoot.getAnimations({ subtree: true });
  return {
    markRect: { w: rootRect.width, h: rootRect.height },
    linkRect: rect ? { w: rect.width, h: rect.height } : null,
    animationCount: anims.length,
    animStates: anims.map((a) => `${a.animationName || a.id || "?"}:${a.playState}`).slice(0, 10),
    markDisplay: getComputedStyle(markRoot).display,
  };
});
console.log("== find busy mark ==", JSON.stringify(findReport, null, 2));
await findPage.screenshot({ path: "/tmp/find-mobile-busy.png" });

// Scroll performance heuristics: heavy backdrop-filters, fixed elements, big layers
const perfReport = await page.evaluate(() => {
  const heavy = [];
  document.querySelectorAll("*").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.backdropFilter && cs.backdropFilter !== "none") {
      heavy.push({ sel: `${el.tagName}.${String(el.className).slice(0, 50)}`, prop: `backdrop-filter: ${cs.backdropFilter}` });
    }
    if (cs.filter && cs.filter !== "none" && cs.filter.includes("drop-shadow")) {
      heavy.push({ sel: `${el.tagName}.${String(el.className).slice(0, 50)}`, prop: `filter: ${cs.filter.slice(0, 60)}` });
    }
  });
  return heavy.slice(0, 20);
});
console.log("== heavy paint styles (analyze) ==", JSON.stringify(perfReport, null, 2));

console.log("== errors ==", JSON.stringify(errors, null, 2));
await browser.close();
server.close();
