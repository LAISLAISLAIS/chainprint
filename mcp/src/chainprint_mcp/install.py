"""Install the ChainprintMCP Ableton Remote Script into the User Library."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


SCRIPT_NAME = "ChainprintMCP"


def user_remote_scripts_dirs() -> list[Path]:
    home = Path.home()
    candidates = [
        home / "Music" / "Ableton" / "User Library" / "Remote Scripts",
        home / "Documents" / "Ableton" / "User Library" / "Remote Scripts",
        # Windows
        home / "Documents" / "Ableton" / "User Library" / "Remote Scripts",
    ]
    # Deduplicate while preserving order
    seen: set[Path] = set()
    out: list[Path] = []
    for p in candidates:
        rp = p.resolve() if p.exists() else p
        if rp in seen:
            continue
        seen.add(rp)
        out.append(p)
    return out


def package_script_source() -> Path:
    # Prefer sibling remote_script/ when developing from the repo
    here = Path(__file__).resolve()
    repo_script = here.parents[2] / "remote_script" / "__init__.py"
    if repo_script.is_file():
        return repo_script
    bundled = here.parent / "remote_script" / "__init__.py"
    if bundled.is_file():
        return bundled
    raise FileNotFoundError(
        "Could not find remote_script/__init__.py next to the package or in mcp/remote_script/."
    )


def install_remote_script(dest_root: Path | None = None) -> Path:
    source = package_script_source()
    if dest_root is None:
        # Prefer an existing User Library Remote Scripts folder
        dest_root = None
        for candidate in user_remote_scripts_dirs():
            if candidate.parent.exists() or candidate.exists():
                dest_root = candidate
                break
        if dest_root is None:
            dest_root = user_remote_scripts_dirs()[0]

    dest_root.mkdir(parents=True, exist_ok=True)
    dest_dir = dest_root / SCRIPT_NAME
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_file = dest_dir / "__init__.py"
    shutil.copy2(source, dest_file)
    return dest_file


def uninstall_remote_script() -> list[Path]:
    removed: list[Path] = []
    for root in user_remote_scripts_dirs():
        target = root / SCRIPT_NAME
        if target.exists():
            shutil.rmtree(target)
            removed.append(target)
    return removed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="chainprint-mcp", description="Chainprint Ableton MCP")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("install", help="Install the Ableton Remote Script")
    sub.add_parser("uninstall", help="Remove the Ableton Remote Script")
    sub.add_parser("serve", help="Run the MCP server (default)")
    args = parser.parse_args(argv)

    if args.cmd == "install":
        path = install_remote_script()
        print(f"Installed ChainprintMCP Remote Script → {path}")
        print()
        print("Next steps:")
        print("  1. Restart Ableton Live")
        print("  2. Settings → Link, Tempo & MIDI")
        print("  3. Set Control Surface to ChainprintMCP (Input/Output: None)")
        return 0

    if args.cmd == "uninstall":
        removed = uninstall_remote_script()
        if not removed:
            print("No ChainprintMCP Remote Script found.")
        else:
            for p in removed:
                print(f"Removed {p}")
        return 0

    # Default: serve
    from .server import run

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
