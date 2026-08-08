/**
 * Resend HTTP helper (Auth still uses Supabase SMTP).
 */

const DEFAULT_FROM = "Chainprint <noreply@mail.chainprint.app>";

export function emailFrom() {
  return String(process.env.EMAIL_FROM || DEFAULT_FROM).trim() || DEFAULT_FROM;
}

export function resendConfigured() {
  return Boolean(String(process.env.RESEND_API_KEY || "").trim());
}

/**
 * @param {{ to: string, subject: string, html: string, idempotencyKey?: string }} opts
 * @returns {Promise<{ ok: boolean, id?: string, skipped?: boolean, error?: string }>}
 */
export async function sendEmail({ to, subject, html, idempotencyKey }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY missing — skip send:", subject);
    return { ok: false, skipped: true, error: "not_configured" };
  }
  const recipient = String(to || "").trim().toLowerCase();
  if (!recipient || !recipient.includes("@")) {
    return { ok: false, error: "invalid_to" };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey).slice(0, 256);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: emailFrom(),
      to: [recipient],
      subject,
      html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `resend_${res.status}`;
    console.warn("[email] send failed:", msg);
    return { ok: false, error: msg };
  }
  return { ok: true, id: data.id };
}
