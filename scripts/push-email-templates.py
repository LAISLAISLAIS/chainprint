#!/usr/bin/env python3
"""Push Chainprint Auth email templates to a hosted Supabase project.

Requires SUPABASE_ACCESS_TOKEN (Personal Access Token) and optional
SUPABASE_PROJECT_REF (default: Chainprint prod).

  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/push-email-templates.py

Note: Free-tier projects using Supabase's default mailer cannot customize
templates until you add custom SMTP (Resend/Postmark/SES) or upgrade.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "supabase" / "email-templates"
DEFAULT_REF = "wggvvgigtwzwivpgszyr"

SUBJECTS = {
    "mailer_subjects_recovery": "Reset your Chainprint password",
    "mailer_subjects_confirmation": "Confirm your email · Chainprint",
    "mailer_subjects_magic_link": "Your Chainprint sign-in link",
    "mailer_subjects_invite": "You’re invited to Chainprint",
    "mailer_subjects_email_change": "Confirm your new email · Chainprint",
    "mailer_subjects_reauthentication": "{{ .Token }} is your Chainprint code",
    "mailer_subjects_password_changed_notification": "Your Chainprint password was changed",
}

CONTENT_FILES = {
    "mailer_templates_recovery_content": "recovery.html",
    "mailer_templates_confirmation_content": "confirmation.html",
    "mailer_templates_magic_link_content": "magic_link.html",
    "mailer_templates_invite_content": "invite.html",
    "mailer_templates_email_change_content": "email_change.html",
    "mailer_templates_reauthentication_content": "reauthentication.html",
    "mailer_templates_password_changed_notification_content": "password_changed.html",
}


def main() -> int:
    token = (os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    ref = (os.environ.get("SUPABASE_PROJECT_REF") or DEFAULT_REF).strip()
    if not token:
        print("Set SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens).", file=sys.stderr)
        return 1

    payload = {
        **SUBJECTS,
        "mailer_notifications_password_changed_enabled": True,
    }
    for key, filename in CONTENT_FILES.items():
        path = TEMPLATES / filename
        if not path.is_file():
            print(f"Missing template: {path}", file=sys.stderr)
            return 1
        payload[key] = path.read_text(encoding="utf-8")

    if "--dry-run" in sys.argv:
        print(
            json.dumps(
                {
                    k: (v if not str(v).startswith("<!") else f"<{len(v)} chars>")
                    for k, v in payload.items()
                },
                indent=2,
            )
        )
        return 0

    # curl avoids local Python SSL-cert issues on some macOS installs
    proc = subprocess.run(
        [
            "curl",
            "-sS",
            "-X",
            "PATCH",
            f"https://api.supabase.com/v1/projects/{ref}/config/auth",
            "-H",
            f"Authorization: Bearer {token}",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ],
        input=json.dumps(payload).encode("utf-8"),
        capture_output=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.decode("utf-8", errors="replace"), file=sys.stderr)
        return 1

    try:
        data = json.loads(proc.stdout.decode("utf-8"))
    except json.JSONDecodeError:
        print(proc.stdout.decode("utf-8", errors="replace"), file=sys.stderr)
        return 1

    if "mailer_subjects_recovery" not in data:
        print(json.dumps(data, indent=2), file=sys.stderr)
        if "free tier" in str(data).lower() or "custom SMTP" in str(data):
            print(
                "\nFix: Authentication → SMTP in Supabase (Resend recommended), then re-run.",
                file=sys.stderr,
            )
        return 1

    for key in SUBJECTS:
        print(f"{key}: {data.get(key)!r}")
    for key in CONTENT_FILES:
        val = data.get(key) or ""
        print(f"{key}: {len(val)} chars")
    print("password_changed notifications:", data.get("mailer_notifications_password_changed_enabled"))
    print("OK — templates pushed to", ref)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
