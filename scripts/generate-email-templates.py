#!/usr/bin/env python3
"""Generate branded Chainprint Auth email HTML into supabase/email-templates/."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "supabase" / "email-templates"

LOGO = "https://chainprint.app/assets/apple-touch-icon.png?v=20260808e"
SITE = "https://chainprint.app"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace"


def shell(
    *,
    title: str,
    preheader: str,
    eyebrow: str,
    heading: str,
    body_html: str,
    cta_label: str | None = None,
    cta_url: str = "{{ .ConfirmationURL }}",
    aside_html: str = "",
) -> str:
    cta = ""
    if cta_label:
        cta = f"""
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                <tr>
                  <td align="left">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{cta_url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" fillcolor="#111111" stroke="f">
                      <center style="color:#ffffff;font-family:Segoe UI,sans-serif;font-size:15px;font-weight:600;">{cta_label}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="{cta_url}" style="display:inline-block;background:#111111;border-radius:10px;padding:14px 22px;font-family:{FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border:1px solid #111111;">
                      {cta_label}
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-family:{FONT};font-size:12px;line-height:1.55;color:#8a8a8a;">
                Button not working? Paste this link into your browser:<br />
                <a href="{cta_url}" style="color:#555555;text-decoration:underline;word-break:break-all;">{cta_url}</a>
              </p>"""

    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{title}</title>
  <!--[if !mso]><!-->
  <style type="text/css">
    @media only screen and (max-width: 620px) {{
      .cp-card {{ width: 100% !important; }}
      .cp-pad {{ padding-left: 22px !important; padding-right: 22px !important; }}
    }}
  </style>
  <!--<![endif]-->
</head>
<body style="margin:0;padding:0;background:#ececec;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ececec;opacity:0;">
    {preheader}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ececec;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" class="cp-card" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#ffffff;border:1px solid #dddddd;border-radius:16px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:#000000;padding:22px 32px;" class="cp-pad">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" width="44" style="width:44px;">
                    <a href="{SITE}" style="text-decoration:none;">
                      <img src="{LOGO}" width="40" height="40" alt="Chainprint" style="display:block;width:40px;height:40px;border:0;border-radius:10px;" />
                    </a>
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <a href="{SITE}" style="font-family:{FONT};font-size:18px;font-weight:700;letter-spacing:-0.03em;color:#ffffff;text-decoration:none;">
                      Chainprint
                    </a>
                  </td>
                  <td valign="middle" align="right">
                    <span style="font-family:{FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a8a;">
                      Account
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Accent -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,#6ec4b4 0%,#3f8f84 55%,#111111 100%);background-color:#6ec4b4;">&nbsp;</td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="cp-pad" style="padding:36px 32px 12px;">
              <p style="margin:0 0 10px;font-family:{FONT};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6ec4b4;">
                {eyebrow}
              </p>
              <h1 style="margin:0 0 16px;font-family:{FONT};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.03em;color:#111111;">
                {heading}
              </h1>
              {body_html}
              {cta}
              {aside_html}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="cp-pad" style="padding:28px 32px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eeeeee;">
                <tr>
                  <td style="padding-top:22px;">
                    <p style="margin:0 0 6px;font-family:{FONT};font-size:13px;line-height:1.5;color:#111111;font-weight:600;">
                      Chainprint
                    </p>
                    <p style="margin:0 0 12px;font-family:{FONT};font-size:12px;line-height:1.55;color:#8a8a8a;">
                      Recreate any mix in your DAW.
                    </p>
                    <p style="margin:0;font-family:{FONT};font-size:12px;line-height:1.55;color:#8a8a8a;">
                      <a href="{SITE}" style="color:#555555;text-decoration:none;font-weight:600;">chainprint.app</a>
                      &nbsp;·&nbsp;
                      <a href="{SITE}/help/" style="color:#555555;text-decoration:none;">Help</a>
                      &nbsp;·&nbsp;
                      <a href="{SITE}/privacy/" style="color:#555555;text-decoration:none;">Privacy</a>
                    </p>
                    <p style="margin:14px 0 0;font-family:{FONT};font-size:11px;line-height:1.5;color:#aaaaaa;">
                      You’re receiving this because of activity on a Chainprint account.
                      If this wasn’t you, you can ignore this message.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-family:{FONT};font-size:11px;line-height:1.4;color:#9a9a9a;">
          © Chainprint · Sent securely via your Chainprint account
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
"""


P = f"font-family:{FONT};font-size:15px;line-height:1.6;color:#444444;"
STRONG = "color:#111111;"
MUTED = f"font-family:{FONT};font-size:13px;line-height:1.55;color:#8a8a8a;"

TEMPLATES: dict[str, str] = {
    "recovery.html": shell(
        title="Reset your password",
        preheader="Choose a new password for your Chainprint account. This link expires shortly.",
        eyebrow="Security",
        heading="Reset your password",
        body_html=f"""
              <p style="margin:0;{P}">
                We received a request to reset the password for
                <strong style="{STRONG}">{{{{ .Email }}}}</strong>.
                Click below to choose a new one. For your security, this link expires shortly and can only be used once.
              </p>
              <p style="margin:16px 0 0;{MUTED}">
                If you didn’t request a reset, you can safely ignore this email — your password will stay the same.
              </p>""",
        cta_label="Choose a new password",
        aside_html=f"""
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;background:#f7faf9;border:1px solid #d7ebe6;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0;font-family:{FONT};font-size:12px;line-height:1.55;color:#3f8f84;">
                      <strong style="color:#24665d;">Tip:</strong> Use a unique password with at least 8 characters, one uppercase letter, one number, and one symbol.
                    </p>
                  </td>
                </tr>
              </table>""",
    ),
    "confirmation.html": shell(
        title="Confirm your email",
        preheader="Confirm your email to finish setting up Chainprint.",
        eyebrow="Welcome",
        heading="Confirm your email",
        body_html=f"""
              <p style="margin:0;{P}">
                Welcome to Chainprint. Confirm
                <strong style="{STRONG}">{{{{ .Email }}}}</strong>
                to finish creating your account and start reverse‑engineering mixes in your DAW.
              </p>""",
        cta_label="Confirm email address",
    ),
    "magic_link.html": shell(
        title="Your sign-in link",
        preheader="Your one-time Chainprint sign-in link is ready.",
        eyebrow="Sign in",
        heading="Your sign-in link",
        body_html=f"""
              <p style="margin:0;{P}">
                Use the button below to sign in to Chainprint. This link works once and expires shortly.
              </p>
              <p style="margin:16px 0 0;{MUTED}">
                If you didn’t try to sign in, you can ignore this email.
              </p>""",
        cta_label="Sign in to Chainprint",
    ),
    "invite.html": shell(
        title="You’re invited to Chainprint",
        preheader="You’ve been invited to create a Chainprint account.",
        eyebrow="Invitation",
        heading="You’re invited",
        body_html=f"""
              <p style="margin:0;{P}">
                You’ve been invited to create a Chainprint account. Accept below to choose your password and get started.
              </p>""",
        cta_label="Accept invitation",
    ),
    "email_change.html": shell(
        title="Confirm your new email",
        preheader="Confirm your new email address for Chainprint.",
        eyebrow="Account update",
        heading="Confirm your new email",
        body_html=f"""
              <p style="margin:0;{P}">
                Confirm <strong style="{STRONG}">{{{{ .NewEmail }}}}</strong> as the new email for your Chainprint account.
              </p>
              <p style="margin:16px 0 0;{MUTED}">
                If you didn’t request this change, ignore this email — your current address will stay active.
              </p>""",
        cta_label="Confirm new email",
    ),
    "reauthentication.html": shell(
        title="Your verification code",
        preheader="Your Chainprint verification code is ready.",
        eyebrow="Verification",
        heading="Your verification code",
        body_html=f"""
              <p style="margin:0;{P}">
                Enter this code in Chainprint to verify it’s you. It expires shortly.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
                <tr>
                  <td style="background:#111111;border-radius:12px;padding:18px 28px;">
                    <p style="margin:0;font-family:{MONO};font-size:32px;letter-spacing:0.18em;font-weight:700;color:#ffffff;text-align:center;">
                      {{{{ .Token }}}}
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;{MUTED}">
                Never share this code with anyone. Chainprint staff will never ask for it.
              </p>""",
    ),
    "password_changed.html": shell(
        title="Your password was changed",
        preheader="Your Chainprint password was changed. If this wasn’t you, reset it now.",
        eyebrow="Security alert",
        heading="Your password was changed",
        body_html=f"""
              <p style="margin:0;{P}">
                The password for your Chainprint account was recently updated.
              </p>
              <p style="margin:16px 0 0;{MUTED}">
                If you made this change, no action is needed.
              </p>""",
        cta_label="Secure my account",
        cta_url=f"{SITE}/auth/?mode=forgot",
        aside_html=f"""
              <p style="margin:20px 0 0;{MUTED}">
                If you didn’t change your password, reset it immediately and review recent account activity.
              </p>""",
    ),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, html in TEMPLATES.items():
        path = OUT / name
        path.write_text(html, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
