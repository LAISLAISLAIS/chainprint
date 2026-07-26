# ChainprintMCP Remote Script for Ableton Live
# Based on ahujasid/ableton-mcp (MIT) — extended for Chainprint mix application.
from __future__ import absolute_import, print_function, unicode_literals

from _Framework.ControlSurface import ControlSurface
import socket
import json
import threading
import time
import traceback

try:
    import Queue as queue  # Python 2 (Live's embedded interpreter on older builds)
except ImportError:
    import queue  # Python 3

DEFAULT_PORT = 9877
HOST = "127.0.0.1"
SCRIPT_VERSION = "0.1.0"


def create_instance(c_instance):
    return ChainprintMCP(c_instance)


class ChainprintMCP(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self.log_message("ChainprintMCP initializing...")
        self.server = None
        self.client_threads = []
        self.server_thread = None
        self.running = False
        self._song = self.song()
        self.start_server()
        self.log_message("ChainprintMCP initialized on port %s" % DEFAULT_PORT)
        self.show_message("ChainprintMCP: listening on port %s" % DEFAULT_PORT)

    def disconnect(self):
        self.log_message("ChainprintMCP disconnecting...")
        self.running = False
        if self.server:
            try:
                self.server.close()
            except Exception:
                pass
        if self.server_thread and self.server_thread.is_alive():
            self.server_thread.join(1.0)
        ControlSurface.disconnect(self)

    def start_server(self):
        try:
            self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server.bind((HOST, DEFAULT_PORT))
            self.server.listen(5)
            self.running = True
            self.server_thread = threading.Thread(target=self._server_thread)
            self.server_thread.daemon = True
            self.server_thread.start()
        except Exception as e:
            self.log_message("Error starting server: " + str(e))
            self.show_message("ChainprintMCP: server error — " + str(e))

    def _server_thread(self):
        self.server.settimeout(1.0)
        while self.running:
            try:
                client, address = self.server.accept()
                self.log_message("Client connected from " + str(address))
                t = threading.Thread(target=self._handle_client, args=(client,))
                t.daemon = True
                t.start()
                self.client_threads.append(t)
                self.client_threads = [x for x in self.client_threads if x.is_alive()]
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:
                    self.log_message("Accept error: " + str(e))
                time.sleep(0.5)

    def _handle_client(self, client):
        client.settimeout(None)
        buffer = ""
        try:
            while self.running:
                data = client.recv(8192)
                if not data:
                    break
                try:
                    buffer += data.decode("utf-8")
                except AttributeError:
                    buffer += data
                try:
                    command = json.loads(buffer)
                    buffer = ""
                    response = self._process_command(command)
                    payload = json.dumps(response)
                    try:
                        client.sendall(payload.encode("utf-8"))
                    except AttributeError:
                        client.sendall(payload)
                except ValueError:
                    continue
        except Exception as e:
            self.log_message("Client handler error: " + str(e))
            try:
                err = json.dumps({"status": "error", "message": str(e)})
                try:
                    client.sendall(err.encode("utf-8"))
                except AttributeError:
                    client.sendall(err)
            except Exception:
                pass
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _run_on_main(self, fn, timeout=15.0):
        response_queue = queue.Queue()

        def task():
            try:
                response_queue.put({"status": "success", "result": fn()})
            except Exception as e:
                self.log_message(traceback.format_exc())
                response_queue.put({"status": "error", "message": str(e)})

        try:
            self.schedule_message(0, task)
        except AssertionError:
            task()
        try:
            resp = response_queue.get(timeout=timeout)
        except queue.Empty:
            return {"status": "error", "message": "Timeout waiting for Live main thread"}
        return resp

    def _process_command(self, command):
        command_type = command.get("type", "")
        params = command.get("params", {}) or {}
        response = {"status": "success", "result": {}}

        try:
            if command_type in ("ping", "get_script_version"):
                response["result"] = {"version": SCRIPT_VERSION, "ok": True, "name": "ChainprintMCP"}
                return response

            read_only = {
                "get_session_info": lambda: self._get_session_info(),
                "get_track_info": lambda: self._get_track_info(params.get("track_index", 0)),
                "get_session_overview": lambda: self._get_session_overview(),
                "list_device_parameters": lambda: self._list_device_parameters(
                    params.get("track_index", 0), params.get("device_index", 0)
                ),
                "measure_track_levels": lambda: self._measure_track_levels(params.get("track_index", 0)),
            }
            if command_type in read_only:
                response["result"] = read_only[command_type]()
                return response

            modifying = {
                "load_browser_item": lambda: self._load_browser_item(
                    params.get("track_index", 0), params.get("item_uri"), params.get("path")
                ),
                "load_device_by_name": lambda: self._load_device_by_name(
                    params.get("track_index", 0), params.get("device_name", "")
                ),
                "set_device_parameter": lambda: self._set_device_parameter(
                    params.get("track_index", 0),
                    params.get("device_index", 0),
                    params.get("parameter_name"),
                    params.get("parameter_index"),
                    params.get("value", 0),
                ),
                "set_track_volume": lambda: self._set_track_volume(
                    params.get("track_index", 0), params.get("value", 0.85)
                ),
                "set_send_level": lambda: self._set_send_level(
                    params.get("track_index", 0), params.get("send_index", 0), params.get("value", 0)
                ),
                "create_return_with_effect": lambda: self._create_return_with_effect(
                    params.get("device_name", "Reverb"), params.get("name")
                ),
                "set_return_device_parameter": lambda: self._set_return_device_parameters(
                    params.get("return_index", 0),
                    params.get("device_index", 0),
                    params.get("parameters") or {},
                ),
                "start_playback": lambda: self._start_playback(),
                "stop_playback": lambda: self._stop_playback(),
                "set_tempo": lambda: self._set_tempo(params.get("tempo", 120)),
            }

            if command_type in modifying:
                task_response = self._run_on_main(modifying[command_type])
                if task_response.get("status") == "error":
                    response["status"] = "error"
                    response["message"] = task_response.get("message", "error")
                else:
                    response["result"] = task_response.get("result", {})
                return response

            response["status"] = "error"
            response["message"] = "Unknown command: " + command_type
        except Exception as e:
            self.log_message(traceback.format_exc())
            response["status"] = "error"
            response["message"] = str(e)
        return response

    # —— reads ——

    def _safe(self, obj, attr, default=None):
        try:
            return getattr(obj, attr)
        except Exception:
            return default

    def _get_session_info(self):
        song = self._song
        return {
            "tempo": song.tempo,
            "signature_numerator": song.signature_numerator,
            "signature_denominator": song.signature_denominator,
            "track_count": len(song.tracks),
            "return_track_count": len(song.return_tracks),
            "is_playing": bool(self._safe(song, "is_playing", False)),
            "current_song_time": float(self._safe(song, "current_song_time", 0) or 0),
            "master_track": {
                "name": "Master",
                "volume": song.master_track.mixer_device.volume.value,
                "panning": song.master_track.mixer_device.panning.value,
            },
        }

    def _device_brief(self, device, index):
        return {
            "index": index,
            "name": device.name,
            "class_name": self._safe(device, "class_name", ""),
            "type": self._device_type(device),
        }

    def _device_type(self, device):
        try:
            if device.can_have_drum_pads:
                return "drum_rack"
            if device.can_have_chains:
                return "rack"
        except Exception:
            pass
        cn = str(self._safe(device, "class_name", "") or "").lower()
        if "instrument" in cn:
            return "instrument"
        if "midi" in cn:
            return "midi_effect"
        return "audio_effect"

    def _get_track_info(self, track_index):
        track_index = int(track_index)
        if track_index < 0 or track_index >= len(self._song.tracks):
            raise IndexError("Track index out of range")
        track = self._song.tracks[track_index]
        devices = [self._device_brief(d, i) for i, d in enumerate(track.devices)]
        sends = []
        try:
            for i, send in enumerate(track.mixer_device.sends):
                sends.append({"index": i, "value": send.value})
        except Exception:
            pass
        return {
            "index": track_index,
            "name": track.name,
            "mute": bool(self._safe(track, "mute", False)),
            "solo": bool(self._safe(track, "solo", False)),
            "volume": track.mixer_device.volume.value,
            "panning": track.mixer_device.panning.value,
            "devices": devices,
            "sends": sends,
        }

    def _get_session_overview(self):
        info = self._get_session_info()
        tracks = []
        for i in range(len(self._song.tracks)):
            t = self._get_track_info(i)
            t["levels"] = self._measure_track_levels(i)
            tracks.append(t)
        returns = []
        for i, track in enumerate(self._song.return_tracks):
            devices = [self._device_brief(d, di) for di, d in enumerate(track.devices)]
            returns.append({"index": i, "name": track.name, "devices": devices})
        return {"session": info, "tracks": tracks, "returns": returns}

    def _list_device_parameters(self, track_index, device_index):
        track = self._song.tracks[int(track_index)]
        device = track.devices[int(device_index)]
        params = []
        for i, p in enumerate(device.parameters):
            try:
                params.append(
                    {
                        "index": i,
                        "name": p.name,
                        "value": p.value,
                        "min": p.min,
                        "max": p.max,
                        "is_enabled": bool(self._safe(p, "is_enabled", True)),
                    }
                )
            except Exception:
                continue
        return {"track_index": int(track_index), "device_index": int(device_index), "device": device.name, "parameters": params}

    def _measure_track_levels(self, track_index):
        track = self._song.tracks[int(track_index)]
        peak = float(self._safe(track, "output_meter_level", 0) or 0)
        left = float(self._safe(track, "output_meter_left", peak) or peak)
        right = float(self._safe(track, "output_meter_right", peak) or peak)
        return {
            "track_index": int(track_index),
            "output_meter_level": peak,
            "output_meter_left": left,
            "output_meter_right": right,
            "peak": max(left, right, peak),
        }

    # —— writes ——

    def _find_browser_item_by_path(self, path):
        """Walk Live's browser by slash-separated folder names."""
        browser = self.application().browser
        if not path:
            return None
        parts = [p for p in str(path).split("/") if p]
        # Try audio effects root first
        roots = []
        for attr in ("audio_effects", "instruments", "midi_effects", "drums", "sounds", "clips", "samples"):
            root = self._safe(browser, attr)
            if root is not None:
                roots.append(root)
        # Also iterate browser's top-level if available
        try:
            for item in browser:
                roots.append(item)
        except Exception:
            pass

        def children_of(item):
            try:
                return list(item.children)
            except Exception:
                return []

        def match_name(item, name):
            try:
                return str(item.name).lower() == str(name).lower()
            except Exception:
                return False

        for root in roots:
            current = root
            ok = True
            # If first part matches root name, skip it
            start = 0
            if parts and match_name(current, parts[0]):
                start = 1
            for part in parts[start:]:
                found = None
                for child in children_of(current):
                    if match_name(child, part):
                        found = child
                        break
                if found is None:
                    ok = False
                    break
                current = found
            if ok and current is not None:
                return current
        return None

    def _load_browser_item(self, track_index, item_uri=None, path=None):
        track = self._song.tracks[int(track_index)]
        item = None
        if path:
            item = self._find_browser_item_by_path(path)
        if item is None and item_uri:
            # URI search is limited; treat uri as path fallback
            item = self._find_browser_item_by_path(item_uri)
        if item is None:
            raise RuntimeError("Browser item not found: %s" % (path or item_uri))
        self._song.view.selected_track = track
        browser = self.application().browser
        browser.load_item(item)
        return {"loaded": True, "path": path or item_uri, "track_index": int(track_index)}

    def _load_device_by_name(self, track_index, device_name):
        mapping = {
            "Utility": "Audio Effects/Utility/Utility",
            "EQ Eight": "Audio Effects/EQ Eight/EQ Eight",
            "Compressor": "Audio Effects/Compressor/Compressor",
            "Saturator": "Audio Effects/Saturator/Saturator",
            "Limiter": "Audio Effects/Limiter/Limiter",
            "Delay": "Audio Effects/Delay/Delay",
            "Reverb": "Audio Effects/Reverb/Reverb",
            "Multiband Dynamics": "Audio Effects/Multiband Dynamics/Multiband Dynamics",
            "Glue Compressor": "Audio Effects/Glue Compressor/Glue Compressor",
        }
        path = mapping.get(device_name) or ("Audio Effects/%s/%s" % (device_name, device_name))
        return self._load_browser_item(track_index, path=path)

    def _find_parameter(self, device, parameter_name=None, parameter_index=None):
        if parameter_index is not None:
            return device.parameters[int(parameter_index)]
        name = str(parameter_name or "").lower().strip()
        for p in device.parameters:
            if str(p.name).lower().strip() == name:
                return p
        # Fuzzy contains
        for p in device.parameters:
            if name and name in str(p.name).lower():
                return p
        raise KeyError("Parameter not found: %s" % parameter_name)

    def _set_device_parameter(self, track_index, device_index, parameter_name, parameter_index, value):
        track = self._song.tracks[int(track_index)]
        device = track.devices[int(device_index)]
        param = self._find_parameter(device, parameter_name, parameter_index)
        v = float(value)
        # Clamp into param range when possible
        try:
            v = max(param.min, min(param.max, v))
        except Exception:
            pass
        param.value = v
        return {
            "track_index": int(track_index),
            "device_index": int(device_index),
            "parameter": param.name,
            "value": param.value,
        }

    def _set_track_volume(self, track_index, value):
        track = self._song.tracks[int(track_index)]
        track.mixer_device.volume.value = max(0.0, min(1.0, float(value)))
        return {"track_index": int(track_index), "volume": track.mixer_device.volume.value}

    def _set_send_level(self, track_index, send_index, value):
        track = self._song.tracks[int(track_index)]
        send = track.mixer_device.sends[int(send_index)]
        send.value = max(0.0, min(1.0, float(value)))
        return {"track_index": int(track_index), "send_index": int(send_index), "value": send.value}

    def _create_return_with_effect(self, device_name, name=None):
        song = self._song
        song.create_return_track()
        return_index = len(song.return_tracks) - 1
        track = song.return_tracks[return_index]
        if name:
            track.name = str(name)
        song.view.selected_track = track
        mapping = {
            "Delay": "Audio Effects/Delay/Delay",
            "Reverb": "Audio Effects/Reverb/Reverb",
        }
        path = mapping.get(device_name) or ("Audio Effects/%s/%s" % (device_name, device_name))
        item = self._find_browser_item_by_path(path)
        if item is None:
            raise RuntimeError("Could not load return effect: " + device_name)
        self.application().browser.load_item(item)
        devices = [self._device_brief(d, i) for i, d in enumerate(track.devices)]
        return {"return_index": return_index, "name": track.name, "devices": devices}

    def _set_return_device_parameters(self, return_index, device_index, parameters):
        track = self._song.return_tracks[int(return_index)]
        device = track.devices[int(device_index)]
        applied = []
        for key, value in (parameters or {}).items():
            if str(key).startswith("_"):
                continue
            try:
                param = self._find_parameter(device, parameter_name=key)
                v = float(value)
                try:
                    v = max(param.min, min(param.max, v))
                except Exception:
                    pass
                param.value = v
                applied.append(param.name)
            except Exception:
                continue
        return {"return_index": int(return_index), "device_index": int(device_index), "applied": applied}

    def _start_playback(self):
        self._song.start_playing()
        return {"playing": True}

    def _stop_playback(self):
        self._song.stop_playing()
        return {"playing": False}

    def _set_tempo(self, tempo):
        self._song.tempo = float(tempo)
        return {"tempo": self._song.tempo}
