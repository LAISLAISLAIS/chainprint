"""Apply a LoadedChain to an Ableton track via the Remote Script bridge."""

from __future__ import annotations

import logging
import time
from typing import Any

from .bridge import AbletonBridge
from .chain import DEVICE_BROWSER_PATHS, LoadedChain, device_for_visual_kind
from .params import (
    compressor_settings,
    delay_settings,
    eq_band_params,
    headroom_target_db,
    reverb_size_params,
    saturator_drive_db,
    utility_width,
)

logger = logging.getLogger("chainprint_mcp.apply")


def _set_params(bridge: AbletonBridge, track_index: int, device_index: int, params: dict[str, Any]) -> list[str]:
    applied: list[str] = []
    for name, value in params.items():
        if str(name).startswith("_"):
            continue
        try:
            bridge.send_command(
                "set_device_parameter",
                {
                    "track_index": track_index,
                    "device_index": device_index,
                    "parameter_name": name,
                    "value": float(value),
                },
            )
            applied.append(name)
        except Exception as exc:  # noqa: BLE001 — best-effort per param
            logger.warning("Could not set %s on device %s: %s", name, device_index, exc)
    return applied


def _load_device(bridge: AbletonBridge, track_index: int, device_name: str) -> int | None:
    path = DEVICE_BROWSER_PATHS.get(device_name)
    before = bridge.send_command("get_track_info", {"track_index": track_index})
    before_count = len(before.get("devices") or [])
    try:
        if path:
            bridge.send_command(
                "load_browser_item",
                {"track_index": track_index, "path": path},
            )
        else:
            bridge.send_command(
                "load_device_by_name",
                {"track_index": track_index, "device_name": device_name},
            )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to load %s: %s", device_name, exc)
        return None
    # Brief settle — Live loads async on main thread
    time.sleep(0.15)
    after = bridge.send_command("get_track_info", {"track_index": track_index})
    devices = after.get("devices") or []
    if len(devices) > before_count:
        return before_count  # new device is appended
    # Fallback: match by name
    for i, d in enumerate(devices):
        if device_name.lower() in str(d.get("name") or "").lower():
            return i
    return len(devices) - 1 if devices else None


def _dial_device(
    bridge: AbletonBridge,
    track_index: int,
    device_index: int,
    device_name: str,
    step: dict[str, Any],
) -> dict[str, Any]:
    visual = step.get("visual") or {}
    kind = str(visual.get("kind") or "").lower()
    applied: list[str] = []
    notes: list[str] = []

    if device_name == "Utility":
        if kind in {"width", "imaging"}:
            params = {"Stereo Width": utility_width(visual.get("mode"))}
        else:
            # Gain staging trim — leave width alone; gain often exposed as Gain
            target = headroom_target_db(visual)
            notes.append(f"Target headroom ≈ {target:.1f} dBFS (use gain_stage to trim)")
            params = {}
        applied = _set_params(bridge, track_index, device_index, params)

    elif device_name == "EQ Eight":
        bands = list(visual.get("bands") or [])[:8]
        for i, band in enumerate(bands):
            applied.extend(_set_params(bridge, track_index, device_index, eq_band_params(band, i)))
        if not bands:
            notes.append("EQ step had no bands")

    elif device_name == "Compressor":
        applied = _set_params(bridge, track_index, device_index, compressor_settings(visual, limiter=False))

    elif device_name == "Limiter":
        # Prefer real Limiter; fall back values from compressor_settings(limiter=True)
        catch = float(visual.get("catchDb") or 2)
        ceiling = float(visual.get("truePeak") or -1.0)
        params = {
            "Gain": catch,
            "Ceiling": ceiling,
        }
        applied = _set_params(bridge, track_index, device_index, params)
        if not applied:
            applied = _set_params(bridge, track_index, device_index, compressor_settings(visual, limiter=True))

    elif device_name == "Saturator":
        drive = saturator_drive_db(visual.get("drive"))
        applied = _set_params(
            bridge,
            track_index,
            device_index,
            {"Drive": drive, "Dry/Wet": 0.35},
        )

    elif device_name == "Multiband Dynamics":
        freq = float(visual.get("freq") or 6500)
        red = float(visual.get("reductionDb") or 3)
        notes.append(f"De-ess approx via Multiband Dynamics · −{red} dB @ {freq:.0f} Hz")
        applied = _set_params(
            bridge,
            track_index,
            device_index,
            {
                "High Frequency": freq,
                "High Threshold": -red * 2,
                "High Ratio": 3.0,
            },
        )

    elif device_name == "Delay":
        applied = _set_params(bridge, track_index, device_index, delay_settings(visual))

    elif device_name == "Reverb":
        applied = _set_params(
            bridge,
            track_index,
            device_index,
            reverb_size_params(visual.get("size"), visual.get("preDelayMs")),
        )

    return {
        "device": device_name,
        "device_index": device_index,
        "title": step.get("title"),
        "kind": kind,
        "parameters_set": applied,
        "notes": notes,
    }


def apply_inserts(
    bridge: AbletonBridge,
    track_index: int,
    loaded: LoadedChain,
    *,
    include_sends: bool = False,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    skipped: list[str] = []

    # Optional leading Utility for width/gain
    width_step = next(
        (s for s in loaded.inserts if str((s.get("visual") or {}).get("kind") or "") in {"width", "imaging"}),
        None,
    )
    gain_step = next(
        (s for s in loaded.inserts if str((s.get("visual") or {}).get("kind") or "") == "gain"),
        None,
    )
    if width_step or gain_step:
        idx = _load_device(bridge, track_index, "Utility")
        if idx is not None:
            step = width_step or gain_step or {}
            results.append(_dial_device(bridge, track_index, idx, "Utility", step))

    for step in loaded.inserts:
        visual = step.get("visual") or {}
        kind = str(visual.get("kind") or "").lower()
        if kind in {"width", "imaging", "gain", "modulation"}:
            continue
        device_name = device_for_visual_kind(kind)
        if not device_name:
            skipped.append(str(step.get("title") or kind or "unknown"))
            continue
        # Delay/reverb on inserts → still apply inline if include_sends is False
        if kind in {"delay", "reverb"} and include_sends:
            continue
        idx = _load_device(bridge, track_index, device_name)
        if idx is None:
            skipped.append(str(step.get("title") or device_name))
            continue
        results.append(_dial_device(bridge, track_index, idx, device_name, step))

    send_results: list[dict[str, Any]] = []
    if include_sends:
        send_results = apply_sends(bridge, track_index, loaded)

    return {
        "track_index": track_index,
        "chain_id": loaded.id,
        "applied": results,
        "sends": send_results,
        "skipped": skipped,
    }


def apply_sends(bridge: AbletonBridge, track_index: int, loaded: LoadedChain) -> list[dict[str, Any]]:
    """Create return tracks for delay/reverb sends and set send levels."""
    out: list[dict[str, Any]] = []
    send_steps = [
        s
        for s in (loaded.sends or loaded.inserts)
        if str((s.get("visual") or {}).get("kind") or "").lower() in {"delay", "reverb"}
    ]
    # Prefer dedicated sends array
    if loaded.sends:
        send_steps = [
            s for s in loaded.sends if str((s.get("visual") or {}).get("kind") or "").lower() in {"delay", "reverb"}
        ]

    for step in send_steps:
        visual = step.get("visual") or {}
        kind = str(visual.get("kind") or "").lower()
        device_name = "Delay" if kind == "delay" else "Reverb"
        try:
            created = bridge.send_command(
                "create_return_with_effect",
                {
                    "device_name": device_name,
                    "name": str(step.get("title") or device_name),
                },
            )
            return_index = int(created.get("return_index", 0))
            # Dial the return's first device
            devices = created.get("devices") or []
            if devices:
                # set params on return track device 0 via specialized command
                bridge.send_command(
                    "set_return_device_parameter",
                    {
                        "return_index": return_index,
                        "device_index": 0,
                        "parameters": (
                            delay_settings(visual)
                            if kind == "delay"
                            else reverb_size_params(visual.get("size"), visual.get("preDelayMs"))
                        ),
                    },
                )
            # Set send amount on source track (0.25 ≈ -12 dB-ish in Live's send scale)
            bridge.send_command(
                "set_send_level",
                {"track_index": track_index, "send_index": return_index, "value": 0.28},
            )
            out.append(
                {
                    "title": step.get("title"),
                    "kind": kind,
                    "return_index": return_index,
                    "send_level": 0.28,
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Send apply failed for %s: %s", step.get("title"), exc)
            out.append({"title": step.get("title"), "error": str(exc)})
    return out


def gain_stage_track(
    bridge: AbletonBridge,
    track_index: int,
    target_db: float,
    *,
    iterations: int = 4,
) -> dict[str, Any]:
    history: list[dict[str, Any]] = []
    for i in range(iterations):
        levels = bridge.send_command("measure_track_levels", {"track_index": track_index})
        peak = float(levels.get("output_meter_level", levels.get("peak", -60)))
        # Live meters are often 0..1 linear — convert if needed
        if 0.0 <= peak <= 1.0:
            import math

            peak_db = -60.0 if peak <= 1e-6 else 20.0 * math.log10(peak)
        else:
            peak_db = peak
        delta = target_db - peak_db
        history.append({"iteration": i, "peak_db": peak_db, "delta_db": delta})
        if abs(delta) < 0.75:
            break
        # Nudge track volume
        info = bridge.send_command("get_track_info", {"track_index": track_index})
        vol = float((info.get("volume") if "volume" in info else None) or 0.85)
        # Approximate: Live volume is 0..1 with 0.85 ≈ 0 dB
        new_vol = max(0.0, min(1.0, vol + (delta / 40.0)))
        bridge.send_command("set_track_volume", {"track_index": track_index, "value": new_vol})
        time.sleep(0.2)
    final = bridge.send_command("measure_track_levels", {"track_index": track_index})
    return {"target_db": target_db, "history": history, "final_levels": final}
