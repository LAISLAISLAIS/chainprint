/**
 * Floating, draggable reference player — seek, volume, play/pause.
 */

import {
  subscribePlayback,
  setVolume,
  getVolume,
  toggleMute,
  togglePlayPause,
  seekAudioRatio,
  stopAudio,
} from "./audio-player.js";

const BARS = 5;
const POS_KEY = "chainprint.playerPos";

/**
 * @param {ParentNode} [parent=document.body]
 */
export function mountPlaybackPulse(parent = document.body) {
  if (typeof document === "undefined") return () => {};
  if (document.querySelector("[data-playback-dock]")) {
    return () => {};
  }

  const el = document.createElement("div");
  el.className = "playback-dock";
  el.setAttribute("data-playback-dock", "");
  el.setAttribute("data-playback-pulse", "");
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Reference player");
  el.innerHTML = `
    <div class="playback-dock-chrome" data-player-drag>
      <span class="playback-dock-grip" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="playback-dock-drag-hint">Drag</span>
      <p class="playback-dock-title" data-player-title>Reference</p>
      <button type="button" class="playback-dock-close" data-player-close aria-label="Close player">
        <span aria-hidden="true"></span>
      </button>
    </div>
    <div class="playback-dock-main">
      <button type="button" class="playback-dock-play" data-player-play aria-label="Play">
        <span class="playback-dock-play-icon" aria-hidden="true"></span>
      </button>
      <div class="playback-dock-timeline">
        <span class="playback-dock-time" data-player-current>0:00</span>
        <label class="playback-dock-seek">
          <span class="visually-hidden">Seek</span>
          <input
            type="range"
            class="playback-dock-seek-range"
            data-player-seek
            min="0"
            max="1000"
            step="1"
            value="0"
            aria-label="Seek"
          />
        </label>
        <span class="playback-dock-time" data-player-duration>0:00</span>
      </div>
    </div>
    <div class="playback-dock-foot">
      <span class="playback-pulse-wave" aria-hidden="true">${Array.from(
        { length: BARS },
        () => "<i></i>"
      ).join("")}</span>
      <button type="button" class="playback-mute" data-playback-mute aria-label="Mute">
        <span class="playback-mute-icon" aria-hidden="true"></span>
      </button>
      <label class="playback-vol">
        <input
          type="range"
          class="playback-vol-range"
          data-playback-volume
          min="0"
          max="1"
          step="0.01"
          value="${getVolume()}"
          aria-label="Playback volume"
        />
      </label>
    </div>
  `;

  parent.appendChild(el);

  const titleEl = el.querySelector("[data-player-title]");
  const playBtn = el.querySelector("[data-player-play]");
  const seek = el.querySelector("[data-player-seek]");
  const currentEl = el.querySelector("[data-player-current]");
  const durationEl = el.querySelector("[data-player-duration]");
  const muteBtn = el.querySelector("[data-playback-mute]");
  const volRange = el.querySelector("[data-playback-volume]");
  const closeBtn = el.querySelector("[data-player-close]");
  const dragHandle = el.querySelector("[data-player-drag]");

  let seeking = false;
  /** @type {{ x: number, y: number } | null} */
  let placed = loadPos();

  function applyPlacement() {
    if (!placed) {
      el.classList.remove("is-placed");
      el.style.left = "";
      el.style.top = "";
      el.style.right = "";
      el.style.bottom = "";
      return;
    }
    el.classList.add("is-placed");
    el.style.left = `${placed.x}px`;
    el.style.top = `${placed.y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  applyPlacement();

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  }

  function syncUi(state) {
    el.classList.toggle("is-live", state.active);
    el.classList.toggle("is-playing", state.playing);
    el.classList.toggle("is-muted", state.muted || state.volume <= 0.001);

    if (titleEl) titleEl.textContent = state.title || "Reference";

    if (playBtn) {
      playBtn.classList.toggle("is-playing", state.playing);
      playBtn.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    }

    if (!seeking && seek) {
      const pct = Math.round((state.progress || 0) * 1000);
      seek.value = String(pct);
      seek.disabled = !(state.duration > 0);
      const fill = state.duration > 0 ? (pct / 1000) * 100 : 0;
      seek.style.background = `linear-gradient(90deg, #f0f0f0 ${fill}%, rgba(255,255,255,0.14) ${fill}%)`;
    }

    if (currentEl) currentEl.textContent = formatTime(state.currentTime);
    if (durationEl) {
      durationEl.textContent = state.duration > 0 ? formatTime(state.duration) : "–:––";
    }

    if (volRange && document.activeElement !== volRange) {
      volRange.value = String(state.volume);
    }
    if (muteBtn) {
      muteBtn.setAttribute(
        "aria-label",
        state.muted || state.volume <= 0.001 ? "Unmute" : "Mute"
      );
      muteBtn.setAttribute(
        "aria-pressed",
        state.muted || state.volume <= 0.001 ? "true" : "false"
      );
    }
  }

  playBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlayPause();
  });

  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopAudio();
  });

  muteBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMute();
  });

  volRange?.addEventListener("input", () => {
    setVolume(Number(volRange.value));
  });

  function onSeekInput() {
    if (!seek) return;
    seeking = true;
    const ratio = Number(seek.value) / 1000;
    seekAudioRatio(ratio);
    const fill = ratio * 100;
    seek.style.background = `linear-gradient(90deg, #f0f0f0 ${fill}%, rgba(255,255,255,0.14) ${fill}%)`;
  }

  seek?.addEventListener("pointerdown", () => {
    seeking = true;
  });
  seek?.addEventListener("input", onSeekInput);
  seek?.addEventListener("change", () => {
    onSeekInput();
    seeking = false;
  });
  seek?.addEventListener("pointerup", () => {
    seeking = false;
  });
  seek?.addEventListener("pointercancel", () => {
    seeking = false;
  });

  /* —— Drag to reposition —— */
  let drag = null;

  function clampPos(x, y) {
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    return {
      x: Math.min(maxX, Math.max(pad, x)),
      y: Math.min(maxY, Math.max(pad, y)),
    };
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    placed = clampPos(e.clientX - drag.ox, e.clientY - drag.oy);
    applyPlacement();
  }

  function onPointerUp() {
    if (!drag) return;
    drag = null;
    el.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    if (placed) savePos(placed);
  }

  dragHandle?.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest("button")) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    // Convert docked (right/bottom) into absolute coords on first drag
    if (!placed) {
      placed = { x: rect.left, y: rect.top };
      applyPlacement();
    }
    drag = { ox: e.clientX - placed.x, oy: e.clientY - placed.y };
    el.classList.add("is-dragging");
    dragHandle.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });

  window.addEventListener("resize", () => {
    if (!placed) return;
    placed = clampPos(placed.x, placed.y);
    applyPlacement();
    savePos(placed);
  });

  const unsub = subscribePlayback((state) => {
    syncUi(state);
    document.body.classList.toggle("is-playing", state.playing);
  });

  return () => {
    unsub();
    document.body.classList.remove("is-playing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    el.remove();
  };
}

function loadPos() {
  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** @param {{ x: number, y: number }} pos */
function savePos(pos) {
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}
