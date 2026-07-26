"""Fetch + normalize Chainprint shared chain payloads."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from . import DEFAULT_API_BASE

UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.I)


@dataclass
class LoadedChain:
    id: str
    track_name: str | None
    target: str | None
    mode: str | None
    key_label: str | None
    bpm: float | None
    chain: dict[str, Any]
    honesty: str | None = None
    estimate_note: str | None = None
    instruments: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def inserts(self) -> list[dict[str, Any]]:
        return list(self.chain.get("inserts") or [])

    @property
    def sends(self) -> list[dict[str, Any]]:
        return list(self.chain.get("sends") or [])


# In-memory cache keyed by share id (per MCP process)
_CACHE: dict[str, LoadedChain] = {}


def extract_chain_id(url_or_id: str) -> str:
    raw = str(url_or_id or "").strip()
    if UUID_RE.match(raw):
        return raw
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query)
    if "id" in qs and qs["id"]:
        candidate = qs["id"][0].strip()
        if UUID_RE.match(candidate):
            return candidate
    # path like /c/<uuid>
    parts = [p for p in parsed.path.split("/") if p]
    for part in reversed(parts):
        if UUID_RE.match(part):
            return part
    raise ValueError("Expected a Chainprint share URL or UUID (…/c/<uuid> or …/c/?id=<uuid>).")


def api_base() -> str:
    return os.environ.get("CHAINPRINT_API_BASE", DEFAULT_API_BASE).rstrip("/")


def fetch_shared_chain(url_or_id: str, *, client: httpx.Client | None = None) -> LoadedChain:
    chain_id = extract_chain_id(url_or_id)
    if chain_id in _CACHE:
        return _CACHE[chain_id]

    url = f"{api_base()}/api/chain/{chain_id}"
    owns_client = client is None
    http = client or httpx.Client(timeout=20.0)
    try:
        res = http.get(url, headers={"Accept": "application/json"})
        if res.status_code == 404:
            raise LookupError(f"Chain not found: {chain_id}")
        res.raise_for_status()
        data = res.json()
    finally:
        if owns_client:
            http.close()

    payload = data.get("payload") or {}
    chain = payload.get("chain") or data.get("chain")
    if not isinstance(chain, dict):
        raise ValueError("Share payload is missing a chain object.")

    loaded = LoadedChain(
        id=chain_id,
        track_name=data.get("track_name"),
        target=data.get("target"),
        mode=data.get("mode"),
        key_label=data.get("key_label"),
        bpm=float(data["bpm"]) if data.get("bpm") is not None else None,
        chain=chain,
        honesty=payload.get("honesty"),
        estimate_note=payload.get("estimateNote"),
        instruments=list(payload.get("instruments") or []),
        raw=data,
    )
    _CACHE[chain_id] = loaded
    return loaded


def get_cached_chain(chain_id: str | None = None) -> LoadedChain | None:
    if chain_id:
        return _CACHE.get(chain_id)
    if len(_CACHE) == 1:
        return next(iter(_CACHE.values()))
    return None


def clear_cache() -> None:
    _CACHE.clear()


def summarize_chain(loaded: LoadedChain) -> dict[str, Any]:
    def step_brief(step: dict[str, Any]) -> dict[str, Any]:
        visual = step.get("visual") or {}
        return {
            "title": step.get("title"),
            "type": step.get("type"),
            "role": step.get("role"),
            "kind": visual.get("kind"),
            "dials": step.get("dials") or [],
        }

    return {
        "id": loaded.id,
        "track_name": loaded.track_name,
        "target": loaded.target,
        "mode": loaded.mode,
        "key_label": loaded.key_label,
        "bpm": loaded.bpm,
        "insert_count": len(loaded.inserts),
        "send_count": len(loaded.sends),
        "inserts": [step_brief(s) for s in loaded.inserts],
        "sends": [step_brief(s) for s in loaded.sends],
        "honesty": loaded.honesty,
    }


# Stock Ableton browser paths used when loading devices
DEVICE_BROWSER_PATHS: dict[str, str] = {
    "Utility": "Audio Effects/Utility/Utility",
    "EQ Eight": "Audio Effects/EQ Eight/EQ Eight",
    "Compressor": "Audio Effects/Compressor/Compressor",
    "Saturator": "Audio Effects/Saturator/Saturator",
    "Limiter": "Audio Effects/Limiter/Limiter",
    "Delay": "Audio Effects/Delay/Delay",
    "Reverb": "Audio Effects/Reverb/Reverb",
    "Multiband Dynamics": "Audio Effects/Multiband Dynamics/Multiband Dynamics",
}


def device_for_visual_kind(kind: str) -> str | None:
    k = str(kind or "").lower()
    return {
        "gain": "Utility",
        "width": "Utility",
        "imaging": "Utility",
        "eq": "EQ Eight",
        "compressor": "Compressor",
        "limiter": "Limiter",
        "saturator": "Saturator",
        "deesser": "Multiband Dynamics",
        "delay": "Delay",
        "reverb": "Reverb",
    }.get(k)
