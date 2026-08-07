/**
 * Site-wide password gate (private beta).
 *
 * Env:
 *   SITE_PASSWORD              — required when gate enabled
 *   SITE_GATE_SIGNING_SECRET   — HMAC secret (falls back to SITE_PASSWORD)
 *   SITE_GATE_ENABLED          — "0" / "false" disables gate (public launch)
 *
 * Exempt: /api/chain/*, /api/stripe/webhook, /api/health, /.netlify/functions/stripe-webhook
 */

const COOKIE_NAME = "cp_site_gate";
const MAX_AGE_SEC = 2592000; // 30 days

function gateEnabled() {
  const v = (Deno.env.get("SITE_GATE_ENABLED") || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function password() {
  return (Deno.env.get("SITE_PASSWORD") || Deno.env.get("SITE_GATE_PASSWORD") || "").trim();
}

function signingSecret() {
  return (Deno.env.get("SITE_GATE_SIGNING_SECRET") || password()).trim();
}

function isExempt(pathname) {
  if (pathname === "/api/chain" || pathname.startsWith("/api/chain/")) return true;
  if (pathname === "/api/stripe/webhook" || pathname.startsWith("/api/stripe/webhook")) return true;
  if (pathname === "/api/health") return true;
  if (pathname.includes("stripe-webhook")) return true;
  return false;
}

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintCookieValue(secret) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `v1.${exp}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

async function validCookie(request, secret) {
  if (!secret) return false;
  const raw = request.headers.get("cookie") || "";
  const part = raw.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!part) return false;
  const value = part.slice(COOKIE_NAME.length + 1);
  const bits = value.split(".");
  if (bits.length !== 3 || bits[0] !== "v1") return false;
  const exp = Number(bits[1]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const payload = `${bits[0]}.${bits[1]}`;
  const expected = await hmacHex(secret, payload);
  if (expected.length !== bits[2].length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) {
    ok |= expected.charCodeAt(i) ^ bits[2].charCodeAt(i);
  }
  return ok === 0;
}

function gateHtml({ error = false, next = "/", misconfigured = false } = {}) {
  const safeNext = String(next || "/").startsWith("/") ? String(next || "/") : "/";
  const msg = misconfigured
    ? "Site gate is misconfigured (SITE_PASSWORD missing)."
    : error
      ? "Wrong password — try again."
      : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Chainprint — Private</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: "DM Sans", "Segoe UI", sans-serif;
      background: #000; color: #f2f2f2;
      padding: 24px;
    }
    .card {
      width: min(400px, 100%);
      display: grid; gap: 16px;
      padding: 28px 24px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      background: rgba(255,255,255,0.03);
    }
    h1 {
      margin: 0;
      font-family: "Syne", "Arial Narrow", sans-serif;
      font-size: 1.6rem; letter-spacing: -0.04em; font-weight: 700;
    }
    p { margin: 0; color: #8a8a8a; font-size: 0.95rem; line-height: 1.45; }
    label { display: grid; gap: 8px; font-size: 0.8rem; color: #9a9a9a; }
    input {
      appearance: none; width: 100%; height: 44px; padding: 0 14px;
      border-radius: 10px; border: 1px solid rgba(255,255,255,0.18);
      background: #0a0a0a; color: #f7f7f7; font: inherit; font-size: 1rem;
    }
    input:focus { outline: none; border-color: rgba(255,255,255,0.4); }
    button {
      appearance: none; height: 44px; border: none; border-radius: 10px;
      background: #f4f4f4; color: #0a0a0a; font: inherit; font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #fff; }
    .err { color: #ffb4b4; font-size: 0.85rem; min-height: 1.2em; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/__unlock">
    <div>
      <h1>Chainprint</h1>
      <p>Private beta — enter the access password to continue.</p>
    </div>
    <input type="hidden" name="next" value="${safeNext.replace(/"/g, "&quot;")}" />
    <label>
      Password
      <input type="password" name="password" autocomplete="current-password" required autofocus ${misconfigured ? "disabled" : ""} />
    </label>
    <p class="err">${msg}</p>
    <button type="submit" ${misconfigured ? "disabled" : ""}>Enter</button>
  </form>
</body>
</html>`;
}

function htmlResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export default async (request, context) => {
  if (!gateEnabled()) {
    return context.next();
  }

  const url = new URL(request.url);
  const { pathname } = url;
  const pw = password();
  const secret = signingSecret();

  if (isExempt(pathname)) {
    return context.next();
  }

  if (!pw || !secret) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/.netlify/")) {
      return new Response(JSON.stringify({ error: "Site gate misconfigured." }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    return htmlResponse(gateHtml({ misconfigured: true, next: "/" }), 503);
  }

  if (await validCookie(request, secret)) {
    return context.next();
  }

  if (pathname === "/__unlock" && request.method === "POST") {
    let submitted = "";
    let next = "/";
    try {
      const form = await request.formData();
      submitted = String(form.get("password") || "");
      const n = String(form.get("next") || "/");
      next = n.startsWith("/") ? n : "/";
    } catch {
      return htmlResponse(gateHtml({ error: true, next: "/" }), 401);
    }

    if (submitted === pw) {
      const cookieVal = await mintCookieValue(secret);
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return new Response(null, {
        status: 303,
        headers: {
          Location: next,
          "Set-Cookie": `${COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`,
          "Cache-Control": "no-store",
        },
      });
    }

    return htmlResponse(gateHtml({ error: true, next }), 401);
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/.netlify/")) {
    return new Response(JSON.stringify({ error: "Site is password-protected." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const next = `${pathname}${url.search}` || "/";
  return htmlResponse(gateHtml({ error: false, next }), 401);
};

export const config = { path: "/*" };
