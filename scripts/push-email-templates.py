#!/usr/bin/env python3
"""Push Chainprint Auth email templates to a hosted Supabase project.

Requires SUPABASE_ACCESS_TOKEN (Personal Access Token) and optional
SUPABASE_PROJECT_REF (default: Chainprint prod).

  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/push-email-templates.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "supabase" / "email-templates"
DEFAULT_REF = "wggvvgigtwzwivpgszyr"

SUBJECTS = {
    "mailer_subjects_recovery": "Reset your Chainprint password",
    "mailer_subjects_confirmation": "Confirm your Chainprint email",
    "mailer_subjects_magic_link": "Your Chainprint sign-in link",
    "mailer_subjects_invite": "You’re invited to Chainprint",
    "mailer_subjects_email_change": "Confirm your new Chainprint email",
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
        print(json.dumps({k: (v if not str(v).startswith("<!") else f"<{len(v)} chars>") for k, v in payload.items()}, indent=2))
        return 0

    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/config/auth",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        print(f"HTTP {err.code}: {body}", file=sys.stderr)
        return 1

    for key in SUBJECTS:
        print(f"{key}: {data.get(key)!r}")
    for key in CONTENT_FILES:
        val = data.get(key) or ""
        print(f"{key}: {len(val)} chars, starts {val[:40]!r}…")
    print("password_changed notifications:", data.get("mailer_notifications_password_changed_enabled"))
    print("OK — templates pushed to", ref)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
