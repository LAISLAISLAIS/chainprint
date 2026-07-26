"""Unit tests for chain parsing + param conversions (no Live required)."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(ROOT))

from chainprint_mcp.chain import extract_chain_id, summarize_chain, LoadedChain  # noqa: E402
from chainprint_mcp.params import (  # noqa: E402
    compressor_settings,
    db_to_linear,
    eq_band_params,
    headroom_target_db,
    parse_delay_ms,
    saturator_drive_db,
    utility_width,
)


def test_extract_chain_id_from_url():
    cid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    assert extract_chain_id(cid) == cid
    assert extract_chain_id(f"https://chainprint.app/c/?id={cid}") == cid
    assert extract_chain_id(f"https://chainprint.app/c/?id={cid}&x=1") == cid


def test_extract_chain_id_rejects_junk():
    with pytest.raises(ValueError):
        extract_chain_id("not-a-uuid")


def test_compressor_threshold_math():
    s = compressor_settings({"ratio": 4, "grDb": 4, "attackMs": 10, "releaseMs": 80})
    assert s["Ratio"] == 4
    assert 0 < s["Threshold"] < 1
    # -18 - 4*1.5 = -24 dB
    assert abs(s["_threshold_db"] - (-24.0)) < 0.01
    assert abs(s["Threshold"] - db_to_linear(-24.0)) < 1e-9


def test_eq_band_params():
    p = eq_band_params({"type": "hpf", "freq": 90, "slope": 24}, 0)
    assert p["1 Filter On A"] == 1.0
    assert p["1 Frequency A"] == 90


def test_utility_width_and_drive():
    assert utility_width("center") == 0.55
    assert saturator_drive_db("high") == 14.0
    assert parse_delay_ms("1/8 (250 ms)") == 250.0


def test_headroom_target():
    assert headroom_target_db({"peakLow": -18, "peakHigh": -12}) == -15.0
    assert headroom_target_db({"headroomDb": -14}) == -14.0


def test_summarize_chain():
    loaded = LoadedChain(
        id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        track_name="Demo",
        target="vocal",
        mode="standard",
        key_label="A minor",
        bpm=120,
        chain={
            "inserts": [
                {
                    "title": "Subtractive EQ",
                    "type": "EQ",
                    "visual": {"kind": "eq", "bands": []},
                    "dials": [{"label": "HPF", "value": "90 Hz"}],
                }
            ],
            "sends": [],
        },
    )
    summary = summarize_chain(loaded)
    assert summary["insert_count"] == 1
    assert summary["inserts"][0]["kind"] == "eq"
