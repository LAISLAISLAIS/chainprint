/**
 * Public shared-chain page: /c/?id=<uuid>
 * Fetches a chain snapshot and renders it read-only with a recreate CTA.
 */

import { fetchSharedChain } from "../share/chain-share.js";

const loading = document.querySelector("[data-share-loading]");
const errorBox = document.querySelector("[data-share-error]");
const errorMsg = document.querySelector("[data-share-error-msg]");
const card = document.querySelector("[data-share-card]");
const artEl = document.querySelector("[data-share-art]");
const kickerEl = document.querySelector("[data-share-kicker]");
const titleEl = document.querySelector("[data-share-title]");
const chipsEl = document.querySelector("[data-share-chips]");
const insertsEl = document.querySelector("[data-share-inserts]");
const sendsEl = document.querySelector("[data-share-sends]");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stepLines(step) {
  if (Array.isArray(step.copy) && step.copy.length) return step.copy;
  if (Array.isArray(step.dials) && step.dials.length) {
    return step.dials.map((d) => `${d.label}: ${d.value}`);
  }
  return [];
}

function stepCard(step, index, kind) {
  const n = kind === "send" ? `S${index + 1}` : String(index + 1).padStart(2, "0");
  const type = String(step.type || (kind === "send" ? "Send" : "Insert")).toUpperCase();
  const lines = stepLines(step)
    .slice(0, 5)
    .map((line) => `<li>${esc(line)}</li>`)
    .join("");
  return `
    <article class="share-step">
      <div class="share-step-head">
        <span class="share-n">${n}</span>
        <div class="share-step-titles">
          <h3>${esc(step.title)}</h3>
          ${step.plugin ? `<p>${esc(step.plugin)}</p>` : ""}
        </div>
        <span class="share-type">${esc(type)}</span>
      </div>
      ${lines ? `<ul class="share-lines">${lines}</ul>` : ""}
    </article>`;
}

function showError(message) {
  loading?.classList.add("hidden");
  card?.classList.add("hidden");
  errorBox?.classList.remove("hidden");
  if (errorMsg && message) errorMsg.textContent = message;
}

function render(row) {
  const chain = row.payload?.chain;
  if (!chain) {
    showError("This share is missing its chain data.");
    return;
  }

  const target = row.target || "vocal";
  const targetLabel =
    target === "instrumental" ? "Instrumental chain" : target === "full" ? "Full-mix chain" : "Vocal chain";
  const modeLabel = row.mode === "deep" ? "Pro / Deep" : "Standard";
  if (kickerEl) kickerEl.textContent = `${targetLabel} · ${modeLabel}`;

  const title = row.track_name || "Reference mix";
  if (titleEl) titleEl.textContent = title;
  document.title = `${title} — chain | Chainprint`;

  if (chipsEl) {
    const bpm = Number(row.bpm);
    const bits = [
      row.key_label ? `Key ${row.key_label}` : "",
      Number.isFinite(bpm) ? `${Math.round(bpm)} BPM` : "",
      row.created_at
        ? new Date(row.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "",
    ].filter(Boolean);
    chipsEl.innerHTML = bits.map((b) => `<span class="share-chip">${esc(b)}</span>`).join("");
  }

  if (artEl && typeof row.artwork_url === "string" && /^https?:/.test(row.artwork_url)) {
    artEl.src = row.artwork_url;
    artEl.classList.remove("hidden");
  }

  const inserts = Array.isArray(chain.inserts) ? chain.inserts : [];
  const sends = Array.isArray(chain.sends) ? chain.sends : [];
  if (insertsEl) {
    insertsEl.innerHTML = inserts.length
      ? inserts.map((s, i) => stepCard(s, i, "insert")).join("")
      : `<p class="share-none">No insert stages.</p>`;
  }
  if (sendsEl) {
    sendsEl.innerHTML = sends.length
      ? sends.map((s, i) => stepCard(s, i, "send")).join("")
      : `<p class="share-none">No send stages.</p>`;
  }

  loading?.classList.add("hidden");
  errorBox?.classList.add("hidden");
  card?.classList.remove("hidden");
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    showError("No chain id in this link.");
    return;
  }
  try {
    const row = await fetchSharedChain(id);
    render(row);
  } catch (err) {
    console.error(err);
    showError(err.message || "Could not load that chain.");
  }
}

init();
