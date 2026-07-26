/**
 * Bottom-left live soundwave while reference audio is playing.
 */

import { subscribePlayback } from "./audio-player.js";

const BARS = 5;

/**
 * @param {ParentNode} [parent=document.body]
 */
export function mountPlaybackPulse(parent = document.body) {
  if (typeof document === "undefined") return () => {};
  if (document.querySelector("[data-playback-pulse]")) {
    // Already mounted
    return () => {};
  }

  const el = document.createElement("div");
  el.className = "playback-pulse";
  el.setAttribute("data-playback-pulse", "");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<span class="playback-pulse-wave">${Array.from(
    { length: BARS },
    () => "<i></i>"
  ).join("")}</span>`;

  parent.appendChild(el);

  const unsub = subscribePlayback(({ playing }) => {
    el.classList.toggle("is-live", playing);
  });

  return () => {
    unsub();
    el.remove();
  };
}
