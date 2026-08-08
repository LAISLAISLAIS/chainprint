/**
 * Send welcome / Pro confirmation emails (service role + Resend).
 */

import { sendEmail, resendConfigured } from "./resend.mjs";
import {
  welcomeEmailHtml,
  welcomeEmailSubject,
  proWelcomeEmailHtml,
  proWelcomeEmailSubject,
} from "./email-templates.mjs";
import { supabaseServiceConfig } from "./supabase.mjs";

async function rest(path, { method = "GET", body } = {}) {
  const { url, key } = supabaseServiceConfig();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res;
}

export async function fetchProfileEmailFields(userId) {
  const res = await rest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,username,plan,welcome_email_sent_at,pro_email_sent_at&limit=1`
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function markSent(userId, column) {
  const res = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { [column]: new Date().toISOString(), updated_at: new Date().toISOString() },
  });
  if (!res.ok) {
    console.warn("[email] mark sent failed", column, await res.text());
  }
}

/**
 * @param {string} userId
 * @returns {Promise<{ sent: boolean, skipped?: boolean, reason?: string }>}
 */
export async function sendWelcomeEmail(userId) {
  if (!resendConfigured()) return { sent: false, skipped: true, reason: "not_configured" };
  const profile = await fetchProfileEmailFields(userId);
  if (!profile?.email) return { sent: false, skipped: true, reason: "no_profile" };
  if (profile.welcome_email_sent_at) return { sent: false, skipped: true, reason: "already_sent" };

  const result = await sendEmail({
    to: profile.email,
    subject: welcomeEmailSubject,
    html: welcomeEmailHtml(profile),
    idempotencyKey: `welcome-${userId}`,
  });
  if (!result.ok) return { sent: false, reason: result.error || "send_failed" };
  await markSent(userId, "welcome_email_sent_at");
  return { sent: true };
}

/**
 * @param {string} userId
 * @param {{ force?: boolean }} [opts]
 */
export async function sendProWelcomeEmail(userId, opts = {}) {
  if (!resendConfigured()) return { sent: false, skipped: true, reason: "not_configured" };
  const profile = await fetchProfileEmailFields(userId);
  if (!profile?.email) return { sent: false, skipped: true, reason: "no_profile" };
  if (!opts.force && profile.pro_email_sent_at) {
    return { sent: false, skipped: true, reason: "already_sent" };
  }

  const result = await sendEmail({
    to: profile.email,
    subject: proWelcomeEmailSubject,
    html: proWelcomeEmailHtml(profile),
    idempotencyKey: `pro-welcome-${userId}`,
  });
  if (!result.ok) return { sent: false, reason: result.error || "send_failed" };
  await markSent(userId, "pro_email_sent_at");
  return { sent: true };
}
