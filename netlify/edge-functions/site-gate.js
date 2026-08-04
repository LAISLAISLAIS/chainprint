/**
 * Site-wide password gate (private beta).
 * Set SITE_PASSWORD in Netlify env to override; default matches launch lock.
 *
 * Exempt: /api/chain/* so Ableton MCP can still fetch share payloads.
 */

const PASSWORD = Deno.env.get("SITE_PASSWORD") || "chainmanpreet";
const COOKIE_NAME = "cp_site_gate";
const COOKIE_VALUE = "1";

function hasGateCookie(request) {
  const raw = request.headers.get("cookie") || "";
  return raw.split(";").some((part) => {
    const [k, ...rest] = part.trim().split("=");
    return k === COOKIE_NAME && rest.join("=") === COOKIE_VALUE;
  });
}

function isExempt(pathname) {
  return pathname === "/api/chain" || pathname.startsWith("/api/chain/");
}

function gateHtml({ error = false, next = "/" } = {}) {
  const safeNext = String(next || "/").startsWith("/") ? String(next || "/") : "/";
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
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    <p class="err">${error ? "Wrong password — try again." : ""}</p>
    <button type="submit">Enter</button>
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
  const url = new URL(request.url);
  const { pathname } = url;

  if (isExempt(pathname)) {
    return context.next();
  }

  if (hasGateCookie(request)) {
    return context.next();
  }

  if (pathname === "/__unlock" && request.method === "POST") {
    let password = "";
    let next = "/";
    try {
      const form = await request.formData();
      password = String(form.get("password") || "");
      const n = String(form.get("next") || "/");
      next = n.startsWith("/") ? n : "/";
    } catch {
      return htmlResponse(gateHtml({ error: true, next: "/" }), 401);
    }

    if (password === PASSWORD) {
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return new Response(null, {
        status: 303,
        headers: {
          Location: next,
          "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
          "Cache-Control": "no-store",
        },
      });
    }

    return htmlResponse(gateHtml({ error: true, next }), 401);
  }

  // Don't hijack POSTs to APIs with a login form
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
