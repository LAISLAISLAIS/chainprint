/**
 * Reference player — desktop floating/draggable dock;
 * mobile fixed bottom bar with expandable track queue.
 */

import {
  subscribePlayback,
  setVolume,
  getVolume,
  toggleMute,
  togglePlayPause,
  seekAudioRatio,
  stopAudio,
  playAudio,
  activeKey,
} from "./audio-player.js";
import {
  getPlaybackTracks,
  subscribePlaylist,
} from "./playback-playlist.js";

const BARS = 5;
const POS_KEY = "chainprint.playerPos";
const MOBILE_MQ = "(max-width: 720px)";

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
    <div class="playback-dock-sheet" data-player-sheet hidden>
      <div class="playback-dock-sheet-head">
        <span>Tracks</span>
        <button type="button" class="playback-dock-sheet-close" data-player-collapse aria-label="Collapse">
          <span aria-hidden="true"></span>
        </button>
      </div>
      <ul class="playback-dock-queue" data-player-queue></ul>
    </div>
    <div class="playback-dock-chrome" data-player-drag>
      <span class="playback-dock-grip" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <button type="button" class="playback-dock-title-btn" data-player-expand-title>
        <p class="playback-dock-title" data-player-title>Reference</p>
      </button>
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
  const titleBtn = el.querySelector("[data-player-expand-title]");
  const playBtn = el.querySelector("[data-player-play]");
  const seek = el.querySelector("[data-player-seek]");
  const currentEl = el.querySelector("[data-player-current]");
  const durationEl = el.querySelector("[data-player-duration]");
  const muteBtn = el.querySelector("[data-playback-mute]");
  const volRange = el.querySelector("[data-playback-volume]");
  const closeBtn = el.querySelector("[data-player-close]");
  const dragHandle = el.querySelector("[data-player-drag]");
  const collapseBtn = el.querySelector("[data-player-collapse]");
  const sheet = el.querySelector("[data-player-sheet]");
  const queueEl = el.querySelector("[data-player-queue]");

  let seeking = false;
  let expanded = false;
  /** @type {{ x: number, y: number } | null} */
  let placed = loadPos();
  const mobileMq = window.matchMedia(MOBILE_MQ);

  function isMobile() {
    return mobileMq.matches;
  }

  function applyPlacement() {
    if (isMobile() || !placed) {
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

  function setExpanded(on) {
    expanded = Boolean(on) && getPlaybackTracks().length > 1;
    el.classList.toggle("is-expanded", expanded);
    if (sheet) sheet.hidden = !expanded;
    if (titleBtn) {
      titleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    renderQueue();
  }

  function renderQueue() {
    if (!queueEl) return;
    const tracks = getPlaybackTracks();
    const key = activeKey();
    syncUi.lastQueueKey = key || "";
    queueEl.innerHTML = tracks
      .map((t) => {
        const on = t.id === key;
        return `<li>
          <button type="button" class="playback-dock-track ${on ? "is-current" : ""}" data-track-id="${escapeAttr(t.id)}">
            <span class="playback-dock-track-title">${escapeHtml(t.title || "Reference")}</span>
            ${on ? '<span class="playback-dock-track-now">Now</span>' : ""}
          </button>
        </li>`;
      })
      .join("");
  }

  function syncQueueChrome() {
    const tracks = getPlaybackTracks();
    const multi = tracks.length > 1;
    el.classList.toggle("has-queue", multi);
    if (titleBtn) {
      titleBtn.title = multi ? "Show tracks" : "";
    }
    if (!multi && expanded) setExpanded(false);
    else if (expanded) renderQueue();
  }

  applyPlacement();
  syncQueueChrome();

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
    document.body.classList.toggle("has-playback-dock", state.active);
    document.body.classList.toggle("is-playing", state.playing);

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
      seek.style.setProperty("--seek-fill", `${fill}%`);
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

    if (expanded) {
      // Queue list only needs rebuild when the active track changes, not every seek tick
      const key = activeKey() || "";
      if (key !== syncUi.lastQueueKey) {
        syncUi.lastQueueKey = key;
        renderQueue();
      }
    }
  }
  syncUi.lastQueueKey = "";

  async function playTrackId(id) {
    const track = getPlaybackTracks().find((t) => t.id === id);
    if (!track) return;
    try {
      await playAudio(track.file, track.id, { title: track.title });
      if (isMobile()) setExpanded(false);
    } catch (err) {
      console.error(err);
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
    setExpanded(false);
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
    seeking = false;
  });
  seek?.addEventListener("pointerup", () => {
    seeking = false;
  });
  seek?.addEventListener("pointercancel", () => {
    seeking = false;
  });

  collapseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(false);
  });

  titleBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (getPlaybackTracks().length > 1) setExpanded(!expanded);
  });

  queueEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-track-id]");
    if (!btn) return;
    e.preventDefault();
    playTrackId(btn.getAttribute("data-track-id"));
  });

  /* —— Desktop drag —— */
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
    if (!drag || isMobile()) return;
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
    if (isMobile()) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest("button")) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
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

  function onResize() {
    applyPlacement();
    if (!isMobile() && placed) {
      placed = clampPos(placed.x, placed.y);
      applyPlacement();
      savePos(placed);
    }
    if (isMobile()) {
      el.classList.remove("is-dragging");
      drag = null;
    }
  }

  function onMqChange() {
    onResize();
    if (!isMobile()) setExpanded(false);
  }

  window.addEventListener("resize", onResize);
  mobileMq.addEventListener?.("change", onMqChange);
  mobileMq.addListener?.(onMqChange);

  const unsubPlay = subscribePlayback(syncUi);
  const unsubList = subscribePlaylist(() => {
    syncQueueChrome();
  });

  return () => {
    unsubPlay();
    unsubList();
    document.body.classList.remove("is-playing", "has-playback-dock");
    window.removeEventListener("resize", onResize);
    mobileMq.removeEventListener?.("change", onMqChange);
    mobileMq.removeListener?.(onMqChange);
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
