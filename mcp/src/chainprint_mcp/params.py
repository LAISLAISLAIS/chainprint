"""Live parameter value conversions — ported from js/export/ableton-rack.js."""

from __future__ import annotations

import math
import re
from typing import Any


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def db_to_linear(db: float) -> float:
    return math.pow(10.0, db / 20.0)


def linear_to_db(lin: float) -> float:
    if lin <= 1e-9:
        return -120.0
    return 20.0 * math.log10(lin)


def parse_delay_ms(time: Any) -> float | None:
    if isinstance(time, (int, float)) and math.isfinite(time):
        return float(time)
    s = str(time or "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*ms", s, re.I)
    if m:
        return float(m.group(1))
    if re.search(r"dotted", s, re.I) and re.search(r"1/8", s):
        return 375.0
    if re.search(r"1/8", s, re.I):
        return 250.0
    if re.search(r"1/4", s, re.I):
        return 500.0
    if re.search(r"1/16", s, re.I):
        return 125.0
    return None


def beat_enum_from_time(time: Any) -> int:
    s = str(time or "")
    if re.search(r"1/16", s):
        return 0
    if re.search(r"1/8", s):
        return 1
    if re.search(r"1/4", s):
        return 2
    if re.search(r"1/2", s):
        return 3
    return 1


def saturator_drive_db(drive: Any) -> float:
    s = str(drive or "low").lower()
    table = {
        "none": 0.0,
        "low": 4.0,
        "light": 4.0,
        "medium": 8.0,
        "med": 8.0,
        "high": 14.0,
        "heavy": 18.0,
    }
    if s in table:
        return table[s]
    try:
        return clamp(float(s), 0.0, 24.0)
    except ValueError:
        return 6.0


def compressor_settings(visual: dict[str, Any], *, limiter: bool = False) -> dict[str, float | int]:
    ratio = clamp(float(visual.get("ratio") or (20 if limiter else 3)), 1.0, 20.0)
    raw_gr = visual.get("grDb", visual.get("catchDb"))
    gr = float(raw_gr) if raw_gr is not None and math.isfinite(float(raw_gr)) else (2.0 if limiter else 4.0)
    threshold_db = clamp((-6.0 - gr) if limiter else (-18.0 - gr * 1.5), -60.0, 0.0)
    attack = clamp(float(visual.get("attackMs") or (1 if limiter else 15)), 0.01, 1000.0)
    release = clamp(float(visual.get("releaseMs") or 80), 1.0, 3000.0)
    makeup = clamp(gr * 0.55, 0.0, 12.0)
    knee = 0.0 if (str(visual.get("knee") or "").lower() == "hard" or limiter) else 6.0
    return {
        "Threshold": db_to_linear(threshold_db),
        "Ratio": ratio,
        "Attack": attack,
        "Release": release,
        "Gain": makeup,
        "Knee": knee,
        "DryWet": 1.0,
        "Model": 0 if limiter else 1,
        "_threshold_db": threshold_db,
        "_gr_db": gr,
    }


def utility_width(mode: str | None) -> float:
    m = str(mode or "center").lower()
    if m == "center":
        return 0.55
    if m in {"focused", "fx_wide", "wide"}:
        return 1.4 if m != "focused" else 0.85
    return 1.0


def reverb_size_params(size: Any, pre_delay_ms: Any) -> dict[str, float]:
    s = str(size or "").lower()
    room_size, decay = 80.0, 2200.0
    if any(k in s for k in ("hall", "large", "ambient")):
        room_size, decay = 220.0, 5500.0
    elif any(k in s for k in ("room", "chamber")):
        room_size, decay = 90.0, 2800.0
    elif any(k in s for k in ("plate", "short")):
        room_size, decay = 35.0, 1100.0
    return {
        "PreDelay": clamp(float(pre_delay_ms or 40), 0.5, 250.0),
        "RoomSize": clamp(room_size, 0.22, 500.0),
        "DecayTime": clamp(decay, 200.0, 60000.0),
        "DryWet": 0.32,
    }


def delay_settings(visual: dict[str, Any]) -> dict[str, Any]:
    ms = clamp(parse_delay_ms(visual.get("time")) or 280.0, 1.0, 300.0)
    feedback_pct = clamp(float(visual.get("feedbackPct") or 20), 0.0, 90.0)
    time_str = str(visual.get("time") or "")
    use_sync = bool(re.search(r"1/\d", time_str))
    return {
        "Sync": 1.0 if use_sync else 0.0,
        "Beat Delay": float(beat_enum_from_time(time_str)),
        "Delay Time": ms,
        "Feedback": feedback_pct / 100.0,
        "Dry/Wet": 0.32,
        "_ms": ms,
        "_use_sync": use_sync,
    }


# EQ Eight filter type enums (Live API / typical stock mapping)
EQ_FILTER_TYPE = {
    "hpf": 0,  # highpass 12/24 approximated
    "highpass": 0,
    "lowpass": 1,
    "lpf": 1,
    "bell": 3,
    "peak": 3,
    "highshelf": 5,
    "lowshelf": 4,
    "notch": 6,
}


def eq_band_params(band: dict[str, Any], index: int) -> dict[str, Any]:
    """Return named parameter hints for EQ Eight band N (1-based in Live UI)."""
    n = index + 1
    ftype = str(band.get("type") or "bell").lower()
    freq = float(band.get("freq") or 1000)
    gain = float(band.get("gain") or 0)
    q = float(band.get("q") or 0.7)
    return {
        f"{n} Filter On A": 1.0,
        f"{n} Filter Type A": float(EQ_FILTER_TYPE.get(ftype, 3)),
        f"{n} Frequency A": clamp(freq, 20.0, 22000.0),
        f"{n} Gain A": clamp(gain, -24.0, 24.0),
        f"{n} Resonance A": clamp(q, 0.1, 18.0),
        "_band_index": index,
        "_type": ftype,
        "_freq": freq,
        "_gain": gain,
        "_q": q,
    }


def headroom_target_db(visual: dict[str, Any] | None) -> float:
    if not visual:
        return -14.0
    low = visual.get("peakLow")
    high = visual.get("peakHigh")
    hr = visual.get("headroomDb")
    if hr is not None and math.isfinite(float(hr)):
        return float(hr)
    vals = [float(v) for v in (low, high) if v is not None and math.isfinite(float(v))]
    if vals:
        return sum(vals) / len(vals)
    return -14.0
