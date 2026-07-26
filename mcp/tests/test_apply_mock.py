"""Mock Ableton bridge — exercises apply_inserts without Live."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(ROOT))

from chainprint_mcp.apply import apply_inserts  # noqa: E402
from chainprint_mcp.chain import LoadedChain  # noqa: E402


class MockBridge:
    def __init__(self):
        self.devices = []
        self.commands = []

    def send_command(self, command_type, params=None):
        params = params or {}
        self.commands.append((command_type, params))
        if command_type == "get_track_info":
            return {
                "index": params.get("track_index", 0),
                "name": "Vocal",
                "devices": list(self.devices),
                "volume": 0.85,
            }
        if command_type in {"load_browser_item", "load_device_by_name"}:
            name = "Device"
            path = str(params.get("path") or params.get("device_name") or "")
            for token in ("EQ Eight", "Compressor", "Utility", "Saturator", "Limiter", "Delay", "Reverb"):
                if token in path or path.endswith(token):
                    name = token
                    break
            self.devices.append({"index": len(self.devices), "name": name, "class_name": name})
            return {"loaded": True}
        if command_type == "set_device_parameter":
            return {"ok": True, **params}
        if command_type == "create_return_with_effect":
            return {"return_index": 0, "name": params.get("name"), "devices": [{"index": 0, "name": params.get("device_name")}]}
        if command_type == "set_return_device_parameter":
            return {"applied": list((params.get("parameters") or {}).keys())}
        if command_type == "set_send_level":
            return {"ok": True}
        return {}


def test_apply_inserts_loads_eq_and_comp():
    bridge = MockBridge()
    loaded = LoadedChain(
        id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        track_name="Demo",
        target="vocal",
        mode="standard",
        key_label=None,
        bpm=None,
        chain={
            "inserts": [
                {
                    "title": "Subtractive EQ",
                    "visual": {
                        "kind": "eq",
                        "bands": [{"type": "hpf", "freq": 90, "slope": 24}],
                    },
                },
                {
                    "title": "Comp",
                    "visual": {"kind": "compressor", "ratio": 3, "grDb": 3, "attackMs": 12, "releaseMs": 90},
                },
            ],
            "sends": [
                {"title": "Room", "visual": {"kind": "reverb", "size": "room", "preDelayMs": 30}},
            ],
        },
    )
    result = apply_inserts(bridge, 0, loaded, include_sends=True)
    kinds = [a.get("kind") for a in result["applied"]]
    assert "eq" in kinds
    assert "compressor" in kinds
    assert result["sends"]
    assert any(c[0] == "set_device_parameter" for c in bridge.commands)
