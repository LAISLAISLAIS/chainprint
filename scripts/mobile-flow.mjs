/* Full mobile flow: signed-in user analyzes a file, taps play, checks bottom-bar player. */
import { chromium } from "playwright";
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  // Force local demo auth so the flow works without a real Supabase session
  if (p === "/js/auth/config.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(`export const authConfig = { supabaseUrl: "", supabaseAnonKey: "", googleClientId: "", appleClientId: "", appleRedirectURI: "" };
export function isSupabaseConfigured() { return false; }`);
    return;
  }
  const file = join(ROOT, p);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`.slice(0, 200)); });

await page.addInitScript(() => {
  const account = {
    id: "test-user", email: "t@t.co", username: "tester", name: "tester",
    displayName: null, avatarUrl: null, defaultTarget: "vocal", defaultMode: "standard",
    passwordHash: "x", provider: "password", providerUserId: null, plan: "pro",
    analysesUsed: 0, analysesIncluded: null, createdAt: new Date().toISOString(),
  };
  localStorage.setItem("chainprint.users.v2", JSON.stringify({ "t@t.co": account }));
  localStorage.setItem("chainprint.session.v2", JSON.stringify({ email: "t@t.co", at: Date.now() }));
});

await page.goto(`${base}/analyze/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

const gateState = await page.evaluate(() => ({
  authGateHidden: document.querySelector('[data-gate="auth"]')?.classList.contains("hidden"),
  quotaGateHidden: document.querySelector('[data-gate="quota"]')?.classList.contains("hidden"),
}));
console.log("gates:", JSON.stringify(gateState));

// Upload a generated WAV via the dropzone file input
await page.evaluate(() => {
  function makeWav(seconds = 3, rate = 22050) {
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
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
      const s = (Math.sin(2 * Math.PI * 220 * t) * 0.5 + Math.sin(2 * Math.PI * 440 * t) * 0.25) * env * 0.6;
      v.setInt16(44 + i * 2, s * 32767, true);
    }
    return new File([buf], "demo-track.wav", { type: "audio/wav" });
  }
  const input = document.querySelector("[data-file-input]") || document.querySelector('input[type="file"]');
  const dt = new DataTransfer();
  dt.items.add(makeWav());
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

// Wait for analysis to finish (library row with play button appears)
try {
  await page.waitForSelector("[data-library-play]", { timeout: 60000 });
  console.log("analysis done — library play button present");
} catch {
  console.log("TIMEOUT waiting for library play button");
  const prog = await page.evaluate(() => document.querySelector("[data-progress-label]")?.textContent);
  console.log("progress label:", prog);
}
await page.screenshot({ path: "/tmp/m1-after-analysis.png", fullPage: false });

// Is the play button actually visible/tappable on mobile?
const playBtnInfo = await page.evaluate(() => {
  const btn = document.querySelector("[data-library-play]");
  if (!btn) return { present: false };
  const rect = btn.getBoundingClientRect();
  const cs = getComputedStyle(btn);
  const centerEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    present: true,
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.width > 0,
    hitTest: centerEl ? (btn.contains(centerEl) || centerEl.contains(btn)) : false,
    hitEl: centerEl ? `${centerEl.tagName}.${String(centerEl.className).slice(0, 60)}` : null,
  };
});
console.log("library play button:", JSON.stringify(playBtnInfo, null, 2));

// Tap it
if (playBtnInfo.present && playBtnInfo.rect.w > 0) {
  await page.evaluate(() => {
    const btn = document.querySelector("[data-library-play]");
    btn.scrollIntoView({ block: "center" });
  });
  await page.click("[data-library-play]");
  await page.waitForTimeout(800);
}

const dockInfo = await page.evaluate(() => {
  const dock = document.querySelector("[data-playback-dock]");
  const rect = dock?.getBoundingClientRect();
  const cs = dock ? getComputedStyle(dock) : null;
  const centerEl = rect ? document.elementFromPoint(window.innerWidth / 2, rect.top + 20) : null;
  return {
    isLive: dock?.classList.contains("is-live"),
    isPlaying: dock?.classList.contains("is-playing"),
    rect: rect ? { top: Math.round(rect.top), height: Math.round(rect.height) } : null,
    viewportH: window.innerHeight,
    opacity: cs?.opacity, transform: cs?.transform, zIndex: cs?.zIndex,
    onTop: centerEl ? dock.contains(centerEl) : false,
    topEl: centerEl ? `${centerEl.tagName}.${String(centerEl.className).slice(0, 70)}` : null,
    hasQueue: dock?.classList.contains("has-queue"),
  };
});
console.log("dock after tap:", JSON.stringify(dockInfo, null, 2));
await page.screenshot({ path: "/tmp/m2-after-play.png" });

// Add a second track to test the expand-up queue
await page.evaluate(() => {
  function makeWav2(seconds = 2, rate = 22050) {
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
      const s = Math.sin(2 * Math.PI * 330 * t) * 0.5;
      v.setInt16(44 + i * 2, s * 32767, true);
    }
    return new File([buf], "second-track.wav", { type: "audio/wav" });
  }
  const input = document.querySelector('input[type="file"]');
  const dt = new DataTransfer();
  dt.items.add(makeWav2());
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
try {
  await page.waitForFunction(() => document.querySelectorAll("[data-library-play]").length >= 2, { timeout: 60000 });
  console.log("second track analyzed");
} catch {
  console.log("TIMEOUT second track");
}
await page.waitForTimeout(500);

// Restart playback so the dock is live, then expand the queue
await page.evaluate(() => {
  document.querySelector("[data-library-play]")?.scrollIntoView({ block: "center" });
});
await page.click("[data-library-play]");
await page.waitForTimeout(600);

const queueInfo = await page.evaluate(() => {
  const dock = document.querySelector("[data-playback-dock]");
  const hint = dock?.querySelector("[data-player-queue-hint]");
  return {
    isLive: dock?.classList.contains("is-live"),
    hasQueue: dock?.classList.contains("has-queue"),
    hintVisible: hint ? !hint.hidden : false,
    hintText: hint?.textContent?.trim(),
  };
});
console.log("queue chrome:", JSON.stringify(queueInfo));

// Tap the title to expand the queue
await page.click("[data-player-expand-title]").catch((e) => console.log("expand tap failed:", e.message.slice(0, 100)));
await page.waitForTimeout(400);
const expandInfo = await page.evaluate(() => {
  const dock = document.querySelector("[data-playback-dock]");
  const sheet = dock?.querySelector("[data-player-sheet]");
  return {
    expanded: dock?.classList.contains("is-expanded"),
    sheetHidden: sheet?.hidden,
    queueItems: dock?.querySelectorAll("[data-track-id]").length,
  };
});
console.log("expanded queue:", JSON.stringify(expandInfo));
await page.screenshot({ path: "/tmp/m3-expanded-queue.png" });

console.log("errors:", JSON.stringify(errors.slice(0, 10), null, 2));
await browser.close();
server.close();
