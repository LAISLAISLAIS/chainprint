"""CLI entry — `chainprint-mcp` / `python -m chainprint_mcp`."""

from __future__ import annotations

import sys

from .install import main as install_main


def main(argv: list[str] | None = None) -> None:
    raise SystemExit(install_main(argv))


if __name__ == "__main__":
    main(sys.argv[1:])
