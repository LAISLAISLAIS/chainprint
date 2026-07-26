/**
 * Shared header auth chrome: Log in / Sign up or account menu.
 */

import { getSession, logout } from "../auth/session.js";
import { analysesRemaining, getPlan } from "../auth/quota.js";

/**
 * @param {HTMLElement | null} root
 * @param {{ homeHref?: string, authHref?: string, logoutHref?: string, next?: string }} [opts]
 */
export function mountAuthNav(root, opts = {}) {
  if (!root) return;
  const authHref = opts.authHref || "../auth/";
  const logoutHref = opts.logoutHref || `${authHref}?mode=login`;
  const account = getSession();

  if (!account) {
    root.innerHTML = `
      <a href="${authHref}?mode=login&next=${encodeURIComponent(opts.next || "/analyze/")}">Log in</a>
      <a class="nav-cta" href="${authHref}?mode=signup&next=${encodeURIComponent(opts.next || "/analyze/")}">Sign up</a>
    `;
    return;
  }

  const left = analysesRemaining(account);
  const plan = getPlan(account);
  const leftLabel = left === Infinity ? "Unlimited" : `${left} left`;
  const label = account.name || account.email.split("@")[0];

  root.innerHTML = `
    <span class="nav-quota" title="${plan.label} plan">${leftLabel}</span>
    <div class="account-menu">
      <button type="button" class="account-menu-trigger" data-account-toggle aria-expanded="false" aria-haspopup="menu">
        ${escapeHtml(label)}
      </button>
      <div class="account-menu-panel" data-account-panel hidden>
        <p class="account-email">${escapeHtml(account.email)}</p>
        <p class="account-plan">${plan.label} · ${leftLabel}</p>
        <button type="button" data-logout>Log out</button>
      </div>
    </div>
  `;

  const toggle = root.querySelector("[data-account-toggle]");
  const panel = root.querySelector("[data-account-panel]");
  const logoutBtn = root.querySelector("[data-logout]");

  function setOpen(open) {
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  toggle?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(Boolean(panel?.hidden));
  });

  logoutBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    logout();
    location.assign(logoutHref);
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(/** @type {Node} */ (e.target))) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
