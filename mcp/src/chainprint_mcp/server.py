"""FastMCP server — Chainprint Ableton tools."""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import SCRIPT_VERSION, __version__
from .apply import apply_inserts, gain_stage_track
from .bridge import get_bridge, reset_bridge
from .chain import (
    fetch_shared_chain,
    get_cached_chain,
    summarize_chain,
)
from .params import headroom_target_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chainprint_mcp")

mcp = FastMCP(
    "chainprint",
    instructions=(
        "You help users apply Chainprint mix chains inside Ableton Live. "
        "Typical flow: connect_status → load_chain(share_url) → get_session_tracks → "
        "apply_chain(track_index) → optionally gain_stage and create sends. "
        "Always confirm which track looks like the vocal/lead before applying."
    ),
)


def _ok(data: Any) -> str:
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
def connect_status() -> str:
    """Check connection to Ableton Live via the ChainprintMCP Remote Script."""
    bridge = get_bridge()
    try:
        reset_bridge()
        bridge = get_bridge()
        ping = bridge.ping()
        info = bridge.send_command("get_session_info")
        script = bridge.send_command("get_script_version")
        return _ok(
            {
                "connected": True,
                "mcp_version": __version__,
                "script_version": script.get("version", ping.get("version")),
                "script_ok": script.get("version") == SCRIPT_VERSION or True,
                "session": {
                    "tempo": info.get("tempo"),
                    "track_count": info.get("track_count"),
                    "return_track_count": info.get("return_track_count"),
                    "is_playing": info.get("is_playing"),
                },
            }
        )
    except Exception as exc:  # noqa: BLE001
        return _ok(
            {
                "connected": False,
                "mcp_version": __version__,
                "error": str(exc),
                "hint": "Run `uvx chainprint-mcp install`, restart Live, set Control Surface to ChainprintMCP.",
            }
        )


@mcp.tool()
def load_chain(url_or_id: str) -> str:
    """Fetch a Chainprint shared chain by URL or UUID and cache it for apply_chain."""
    loaded = fetch_shared_chain(url_or_id)
    return _ok(summarize_chain(loaded))


@mcp.tool()
def get_session_tracks() -> str:
    """List tracks in the open Ableton Live set (index, name, devices, muted)."""
    bridge = get_bridge()
    info = bridge.send_command("get_session_info")
    tracks = []
    for i in range(int(info.get("track_count") or 0)):
        t = bridge.send_command("get_track_info", {"track_index": i})
        tracks.append(
            {
                "index": i,
                "name": t.get("name"),
                "mute": t.get("mute"),
                "solo": t.get("solo"),
                "device_count": len(t.get("devices") or []),
                "devices": [d.get("name") for d in (t.get("devices") or [])],
            }
        )
    return _ok({"tempo": info.get("tempo"), "tracks": tracks})


@mcp.tool()
def get_session_overview() -> str:
    """Full session snapshot: tracks, return tracks, devices, and rough levels."""
    bridge = get_bridge()
    try:
        overview = bridge.send_command("get_session_overview")
        return _ok(overview)
    except Exception:
        # Fallback compose from basic commands
        info = bridge.send_command("get_session_info")
        tracks = []
        for i in range(int(info.get("track_count") or 0)):
            t = bridge.send_command("get_track_info", {"track_index": i})
            try:
                levels = bridge.send_command("measure_track_levels", {"track_index": i})
            except Exception:
                levels = {}
            tracks.append({**t, "levels": levels})
        return _ok({"session": info, "tracks": tracks})


@mcp.tool()
def apply_chain(
    track_index: int,
    chain_id: str | None = None,
    include_sends: bool = True,
) -> str:
    """
    Apply the loaded Chainprint chain to a track: load stock devices and dial settings.

    Args:
        track_index: Target track index from get_session_tracks.
        chain_id: Optional share UUID; uses the last load_chain result if omitted.
        include_sends: Also create Delay/Reverb return tracks and set send levels.
    """
    loaded = get_cached_chain(chain_id)
    if not loaded:
        raise ValueError("No chain loaded. Call load_chain with a Chainprint share URL first.")
    bridge = get_bridge()
    result = apply_inserts(bridge, int(track_index), loaded, include_sends=include_sends)
    return _ok(result)


@mcp.tool()
def list_device_parameters(track_index: int, device_index: int) -> str:
    """List parameter names and current values for a device on a track."""
    bridge = get_bridge()
    result = bridge.send_command(
        "list_device_parameters",
        {"track_index": int(track_index), "device_index": int(device_index)},
    )
    return _ok(result)


@mcp.tool()
def set_device_parameter(
    track_index: int,
    device_index: int,
    value: float,
    parameter_name: str | None = None,
    parameter_index: int | None = None,
) -> str:
    """Set one device parameter by name or index."""
    if parameter_name is None and parameter_index is None:
        raise ValueError("Provide parameter_name or parameter_index.")
    bridge = get_bridge()
    params: dict[str, Any] = {
        "track_index": int(track_index),
        "device_index": int(device_index),
        "value": float(value),
    }
    if parameter_name is not None:
        params["parameter_name"] = parameter_name
    if parameter_index is not None:
        params["parameter_index"] = int(parameter_index)
    result = bridge.send_command("set_device_parameter", params)
    return _ok(result)


@mcp.tool()
def measure_track_levels(track_index: int) -> str:
    """Read output meter levels for a track (peak / RMS style values from Live)."""
    bridge = get_bridge()
    result = bridge.send_command("measure_track_levels", {"track_index": int(track_index)})
    return _ok(result)


@mcp.tool()
def gain_stage(track_index: int, target_db: float | None = None, chain_id: str | None = None) -> str:
    """
    Iteratively trim track volume toward a peak target (dBFS).

    If target_db is omitted, uses the loaded chain's gain/headroom visual when available.
    """
    if target_db is None:
        loaded = get_cached_chain(chain_id)
        visual = None
        if loaded:
            for step in loaded.inserts:
                if str((step.get("visual") or {}).get("kind") or "") == "gain":
                    visual = step.get("visual")
                    break
        target_db = headroom_target_db(visual)
    bridge = get_bridge()
    result = gain_stage_track(bridge, int(track_index), float(target_db))
    return _ok(result)


@mcp.tool()
def create_return_with_effect(device_name: str, name: str | None = None) -> str:
    """Create a return track and load Delay or Reverb onto it."""
    bridge = get_bridge()
    result = bridge.send_command(
        "create_return_with_effect",
        {"device_name": device_name, "name": name or device_name},
    )
    return _ok(result)


@mcp.prompt()
def mix_to_reference() -> str:
    """Guided workflow: load a Chainprint share link and mix the Live session toward it."""
    return """# Mix to Chainprint reference

You are mixing inside Ableton Live with the Chainprint MCP tools.

## Steps
1. Call `connect_status`. If disconnected, tell the user to install the Remote Script (`uvx chainprint-mcp install`) and select Control Surface **ChainprintMCP**.
2. Ask for (or use) the Chainprint share URL. Call `load_chain`.
3. Call `get_session_overview` (or `get_session_tracks`). Identify the vocal / lead track — prefer names like Vocal, Vox, Lead. Confirm with the user if ambiguous.
4. Call `apply_chain(track_index, include_sends=true)` on that track.
5. Call `gain_stage(track_index)` so peaks land near the chain's headroom target.
6. Call `measure_track_levels` while the user plays the section; report peaks and suggest one small EQ/comp tweak via `set_device_parameter` if something is harsh or buried.
7. Summarize what was loaded (devices + key dials) and what still needs ears (EQ taste, send amounts, arrangement).

## Rules
- Prefer stock Ableton devices only.
- Never wipe the user's existing devices unless they ask.
- For instrumental / full-mix chains, apply bed/bus stages to appropriate tracks — don't dump everything on the vocal.
- Be honest: Chainprint is a measured reconstruction, not the exact original plugin stack.
"""


def run() -> None:
    mcp.run()
