/**
 * Bottom-right live soundwave + volume while reference audio is playing.
 */

import {
  subscribePlayback,
  setVolume,
  getVolume,
  toggleMute,
} from "./audio-player.js";

const BARS = 5;

/**
 * @param {ParentNode} [parent=document.body]
 */
export function mountPlaybackPulse(parent = document.body) {
  if (typeof document === "undefined") return () => {};
  if (document.querySelector("[data-playback-pulse]")) {
    return () => {};
  }

  const el = document.createElement("div");
  el.className = "playback-pulse";
  el.setAttribute("data-playback-pulse", "");
  el.innerHTML = `
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
  `;

  parent.appendChild(el);

  const muteBtn = el.querySelector("[data-playback-mute]");
  const range = el.querySelector("[data-playback-volume]");

  function syncUi({ playing, volume, muted }) {
    el.classList.toggle("is-live", playing);
    el.classList.toggle("is-muted", muted || volume <= 0.001);
    if (range && document.activeElement !== range) {
      range.value = String(volume);
    }
    if (muteBtn) {
      muteBtn.setAttribute("aria-label", muted || volume <= 0.001 ? "Unmute" : "Mute");
      muteBtn.setAttribute("aria-pressed", muted || volume <= 0.001 ? "true" : "false");
    }
  }

  muteBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMute();
  });

  range?.addEventListener("input", () => {
    setVolume(Number(range.value));
  });

  const unsub = subscribePlayback((state) => {
    syncUi(state);
    document.body.classList.toggle("is-playing", state.playing);
  });

  return () => {
    unsub();
    document.body.classList.remove("is-playing");
    el.remove();
  };
}
