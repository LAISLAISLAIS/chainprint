/**
 * Branded HTML for transactional product emails (welcome + Pro).
 */

const SITE = "https://chainprint.app";
const LOGO = `${SITE}/assets/apple-touch-icon.png?v=20260808h`;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function shell({ title, preheader, eyebrow, heading, bodyHtml, ctaLabel, ctaUrl }) {
  const cta = ctaLabel
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                <tr>
                  <td>
                    <a href="${ctaUrl}" style="display:inline-block;background:#111111;border-radius:10px;padding:14px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;">
                      ${ctaLabel}
                    </a>
                  </td>
                </tr>
              </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#ececec;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececec;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:#ffffff;border:1px solid #dddddd;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:#000000;padding:22px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;">
                    <img src="${LOGO}" width="40" height="40" alt="Chainprint" style="display:block;border-radius:10px;border:0;" />
                  </td>
                  <td style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:-0.03em;color:#ffffff;">
                    Chainprint
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background-color:#6ec4b4;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:36px 32px 12px;">
              <p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6ec4b4;">
                ${eyebrow}
              </p>
              <h1 style="margin:0 0 16px;font-family:${FONT};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.03em;color:#111111;">
                ${heading}
              </h1>
              ${bodyHtml}
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 32px;">
              <p style="margin:0;padding-top:22px;border-top:1px solid #eeeeee;font-family:${FONT};font-size:12px;line-height:1.55;color:#8a8a8a;">
                <a href="${SITE}" style="color:#555555;font-weight:600;text-decoration:none;">chainprint.app</a>
                · Recreate any mix in your DAW.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {{ username?: string, email?: string }} profile */
export function welcomeEmailHtml(profile) {
  const name = escapeHtml(profile.username || "there");
  return shell({
    title: "Welcome to Chainprint",
    preheader: "Your account is ready — drop a reference and recreate the chain in your DAW.",
    eyebrow: "Welcome",
    heading: `Welcome, ${name}`,
    bodyHtml: `
              <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#444444;">
                Your Chainprint account is ready. Upload a reference mix, reverse‑engineer the vocal chain, and rebuild it in Ableton or your DAW.
              </p>
              <p style="margin:16px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#444444;">
                Free includes a limited analysis. When you want Deep mode and unlimited runs, upgrade to <strong style="color:#111111;">Chainprint Pro</strong>.
              </p>`,
    ctaLabel: "Analyze a mix",
    ctaUrl: `${SITE}/analyze/`,
  });
}

/** @param {{ username?: string }} profile */
export function proWelcomeEmailHtml(profile) {
  const name = escapeHtml(profile.username || "there");
  return shell({
    title: "You’re on Chainprint Pro",
    preheader: "Pro is active — unlimited analyses and Deep mode are unlocked.",
    eyebrow: "Pro",
    heading: `You’re Pro, ${name}`,
    bodyHtml: `
              <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#444444;">
                Thanks for upgrading. Your account now has unlimited mix analyses plus Deep mode — Design, Master, and fuller vocal character reads.
              </p>
              <p style="margin:16px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:#444444;">
                Jump back into the studio and push a reference through Deep when you need the fuller read.
              </p>`,
    ctaLabel: "Open studio",
    ctaUrl: `${SITE}/analyze/`,
  });
}

export const welcomeEmailSubject = "Welcome to Chainprint";
export const proWelcomeEmailSubject = "You’re on Chainprint Pro";
