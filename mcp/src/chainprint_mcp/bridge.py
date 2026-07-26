"""TCP bridge to the ChainprintMCP Ableton Remote Script."""

from __future__ import annotations

import json
import logging
import os
import socket
from dataclasses import dataclass, field
from typing import Any

from . import DEFAULT_PORT

logger = logging.getLogger("chainprint_mcp.bridge")

ABLETON_HOST = os.environ.get("CHAINPRINT_ABLETON_HOST", "127.0.0.1")
ABLETON_PORT = int(os.environ.get("CHAINPRINT_ABLETON_PORT", str(DEFAULT_PORT)))


@dataclass
class AbletonBridge:
    host: str = ABLETON_HOST
    port: int = ABLETON_PORT
    sock: socket.socket | None = field(default=None, repr=False)

    def connect(self) -> bool:
        if self.sock:
            return True
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(5.0)
            self.sock.connect((self.host, self.port))
            self.sock.settimeout(None)
            logger.info("Connected to Ableton at %s:%s", self.host, self.port)
            return True
        except OSError as exc:
            logger.error("Failed to connect to Ableton: %s", exc)
            self.sock = None
            return False

    def disconnect(self) -> None:
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            finally:
                self.sock = None

    def _recv_json(self, timeout: float = 15.0) -> dict[str, Any]:
        if not self.sock:
            raise ConnectionError("Not connected to Ableton")
        self.sock.settimeout(timeout)
        chunks: list[bytes] = []
        while True:
            chunk = self.sock.recv(8192)
            if not chunk:
                if not chunks:
                    raise ConnectionError("Connection closed by Ableton")
                break
            chunks.append(chunk)
            data = b"".join(chunks)
            try:
                return json.loads(data.decode("utf-8"))
            except json.JSONDecodeError:
                continue

    def send_command(self, command_type: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.sock and not self.connect():
            raise ConnectionError(
                "Not connected to Ableton. Open Live, set Control Surface to ChainprintMCP, "
                f"and ensure port {self.port} is free."
            )
        assert self.sock is not None
        payload = {"type": command_type, "params": params or {}}
        modifying = command_type not in {
            "get_session_info",
            "get_track_info",
            "get_session_overview",
            "list_device_parameters",
            "measure_track_levels",
            "get_browser_tree",
            "get_browser_items_at_path",
            "ping",
            "get_script_version",
        }
        try:
            self.sock.sendall(json.dumps(payload).encode("utf-8"))
            response = self._recv_json(timeout=20.0 if modifying else 10.0)
        except (OSError, TimeoutError, json.JSONDecodeError) as exc:
            self.disconnect()
            raise ConnectionError(f"Ableton communication failed: {exc}") from exc

        if response.get("status") == "error":
            raise RuntimeError(response.get("message", "Unknown Ableton error"))
        result = response.get("result", {})
        return result if isinstance(result, dict) else {"value": result}

    def ping(self) -> dict[str, Any]:
        return self.send_command("ping")


_bridge: AbletonBridge | None = None


def get_bridge() -> AbletonBridge:
    global _bridge
    if _bridge is None:
        _bridge = AbletonBridge()
    return _bridge


def reset_bridge() -> None:
    global _bridge
    if _bridge:
        _bridge.disconnect()
    _bridge = None
