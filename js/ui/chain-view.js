/**
 * Public shared-chain page: /c/:id or /c/?id=<uuid>
 */

import { fetchSharedChain, shareIdFromLocation, shareUrl } from "../share/chain-share.js";

const loading = document.querySelector("[data-share-loading]");
const errorBox = document.querySelector("[data-share-error]");
const errorMsg = document.querySelector("[data-share-error-msg]");
const card = document.querySelector("[data-share-card]");
const artEl = document.querySelector("[data-share-art]");
const kickerEl = document.querySelector("[data-share-kicker]");
const titleEl = document.querySelector("[data-share-title]");
const chipsEl = document.querySelector("[data-share-chips]");
const whyEl = document.querySelector("[data-share-why]");
const stripEl = document.querySelector("[data-share-strip]");
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

function renderStrip(inserts, sends) {
  if (!stripEl) return;
  const stages = [
    ...inserts.map((s) => ({ label: s.title || s.type || "Insert", kind: "insert" })),
    ...sends.map((s) => ({ label: s.title || s.type || "Send", kind: "send" })),
  ].slice(0, 12);
  if (!stages.length) {
    stripEl.innerHTML = "";
    stripEl.hidden = true;
    return;
  }
  stripEl.hidden = false;
  stripEl.innerHTML = stages
    .map(
      (s, i) => `
      <span class="share-strip-stage" data-kind="${esc(s.kind)}">
        <span class="share-strip-n">${i + 1}</span>
        <span class="share-strip-label">${esc(s.label)}</span>
      </span>
      ${i < stages.length - 1 ? `<span class="share-strip-join" aria-hidden="true"></span>` : ""}`
    )
    .join("");
}

function render(row, id) {
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

  const why = row.payload?.honesty || row.payload?.estimateNote || "";
  if (whyEl) {
    whyEl.textContent =
      why ||
      "Reverse-engineered with Chainprint. Open each processor in order and set the values below.";
  }

  if (artEl && typeof row.artwork_url === "string" && /^https?:/.test(row.artwork_url)) {
    artEl.src = row.artwork_url;
    artEl.classList.remove("hidden");
  }

  const inserts = Array.isArray(chain.inserts) ? chain.inserts : [];
  const sends = Array.isArray(chain.sends) ? chain.sends : [];
  renderStrip(inserts, sends);

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

  const shareLink = id ? shareUrl(id) : location.href.split("#")[0];
  const mcpBlock = document.querySelector("[data-share-mcp]");
  const mcpUrl = document.querySelector("[data-share-mcp-url]");
  const mcpCopy = document.querySelector("[data-share-mcp-copy]");
  if (mcpBlock && mcpUrl) {
    mcpUrl.value = shareLink;
    mcpBlock.hidden = false;
    mcpCopy?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareLink);
        mcpCopy.textContent = "Copied";
        setTimeout(() => {
          if (mcpCopy) mcpCopy.textContent = "Copy";
        }, 1600);
      } catch {
        mcpUrl.select();
      }
    });
  }
}

function readBootstrap() {
  const el = document.getElementById("share-bootstrap");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

async function init() {
  const boot = readBootstrap();
  if (boot?.row?.payload?.chain && boot.id) {
    render(boot.row, boot.id);
    return;
  }

  const id = shareIdFromLocation();
  if (!id) {
    showError("No chain id in this link.");
    return;
  }

  // Prefer path URLs (/c/:id) so crawlers hit the SSR function with dynamic OG
  if (location.search.includes("id=") && !/\/c\/[0-9a-f-]{36}/i.test(location.pathname)) {
    history.replaceState(null, "", `/c/${encodeURIComponent(id)}`);
  }

  try {
    const row = await fetchSharedChain(id);
    render(row, id);
  } catch (err) {
    console.error(err);
    showError(err.message || "Could not load that chain.");
  }
}

init();
