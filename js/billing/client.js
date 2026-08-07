/**
 * Browser helpers for Stripe Checkout / Portal / session reconcile.
 */

function authHeaders(accessToken) {
  const h = { "Content-Type": "application/json" };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  return h;
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** @param {string} accessToken Supabase session access_token */
export async function startCheckout(accessToken, plan = "pro") {
  const res = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ plan }),
  });
  const data = await parseJson(res);
  if (!data.url) throw new Error("Checkout URL missing.");
  window.location.href = data.url;
  return data;
}

export async function openBillingPortal(accessToken) {
  const res = await fetch("/api/stripe/portal", {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  const data = await parseJson(res);
  if (!data.url) throw new Error("Portal URL missing.");
  window.location.href = data.url;
  return data;
}

export async function fetchBillingSession(accessToken, sessionId) {
  const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(`/api/stripe/session${q}`, {
    headers: authHeaders(accessToken),
  });
  return parseJson(res);
}
