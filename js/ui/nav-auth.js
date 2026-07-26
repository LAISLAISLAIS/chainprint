/**
 * Shared header auth chrome: Log in / Sign up or account menu.
 */

import { getSession, initAuth, logout } from "../auth/session.js";
import { analysesRemaining, getPlan } from "../auth/quota.js";
import { avatarInitials } from "../auth/avatar.js";

/**
 * @param {HTMLElement | null} root
 * @param {{ homeHref?: string, authHref?: string, logoutHref?: string, next?: string, settingsHref?: string }} [opts]
 */
export async function mountAuthNav(root, opts = {}) {
  if (!root) return;
  await initAuth();

  const authHref = opts.authHref || "../auth/";
  const logoutHref = opts.logoutHref || `${authHref}?mode=login`;
  const settingsHref = opts.settingsHref || "../settings/";
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
  const label = account.displayName || account.username || account.name || account.email.split("@")[0];
  const initials = escapeHtml(avatarInitials(account));
  const avatar = account.avatarUrl
    ? `<img class="account-avatar-img" src="${escapeHtml(account.avatarUrl)}" alt="" />`
    : `<span class="account-avatar-fallback">${initials}</span>`;

  root.innerHTML = `
    <span class="nav-quota" title="${escapeHtml(plan.label)} plan">${escapeHtml(leftLabel)}</span>
    <div class="account-menu">
      <button type="button" class="account-menu-trigger" data-account-toggle aria-expanded="false" aria-haspopup="menu">
        <span class="account-avatar">${avatar}</span>
        <span class="account-trigger-label">${escapeHtml(label)}</span>
      </button>
      <div class="account-menu-panel" data-account-panel hidden>
        <p class="account-email">@${escapeHtml(account.username || label)}</p>
        <p class="account-plan">${escapeHtml(account.email)}</p>
        <p class="account-plan">${escapeHtml(plan.label)} · ${escapeHtml(leftLabel)}</p>
        <a class="account-menu-link" href="${settingsHref}">Settings</a>
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

  logoutBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await logout();
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
