/**
 * Origin allowlist for authenticated / write APIs.
 * Public read proxies may still use a wider policy via allowPublic.
 */

function parseOrigins() {
  const raw = String(process.env.CORS_ORIGINS || process.env.SITE_URL || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function corsHeaders(event, { allowPublic = false } = {}) {
  const requestOrigin = String(
    event.headers?.origin || event.headers?.Origin || ""
  ).replace(/\/$/, "");
  const allowed = parseOrigins();
  const base = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin",
  };

  if (allowPublic && !allowed.length) {
    return { ...base, "Access-Control-Allow-Origin": "*" };
  }

  if (requestOrigin && allowed.includes(requestOrigin)) {
    return { ...base, "Access-Control-Allow-Origin": requestOrigin };
  }

  // Same-origin navigations often omit Origin; allow SITE_URL as default echo
  if (!requestOrigin && allowed[0]) {
    return { ...base, "Access-Control-Allow-Origin": allowed[0] };
  }

  if (allowPublic) {
    return { ...base, "Access-Control-Allow-Origin": "*" };
  }

  // Reject: no ACAO header (browser will block)
  return base;
}

export function isOriginAllowed(event) {
  const requestOrigin = String(
    event.headers?.origin || event.headers?.Origin || ""
  ).replace(/\/$/, "");
  if (!requestOrigin) return true; // non-CORS / same-origin
  const allowed = parseOrigins();
  if (!allowed.length) {
    // Fail closed for write routes when misconfigured in production
    return process.env.CONTEXT !== "production" && process.env.NETLIFY_DEV === "true";
  }
  return allowed.includes(requestOrigin);
}
