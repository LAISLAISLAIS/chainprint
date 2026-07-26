/**
 * Account settings page.
 */

import {
  changePassword,
  clearAvatar,
  getSession,
  initAuth,
  updateAccount,
  updateAvatar,
} from "../auth/session.js";
import { avatarInitials } from "../auth/avatar.js";
import { analysesRemaining, canUseMode, getPlan } from "../auth/quota.js";
import { validatePassword } from "../auth/validation.js";
import { mountAuthNav } from "./nav-auth.js";

await initAuth();

const account = getSession();
if (!account) {
  location.replace(`../auth/?mode=login&next=${encodeURIComponent("/settings/")}`);
} else {
  await bootSettings(account);
}

/**
 * @param {NonNullable<ReturnType<typeof getSession>>} account
 */
async function bootSettings(account) {
  const navOpts = {
    authHref: "../auth/",
    next: "/settings/",
    settingsHref: "./",
  };

  await mountAuthNav(document.querySelector("[data-auth-nav]"), navOpts);

  const avatarImg = document.querySelector("[data-avatar-img]");
  const avatarFallback = document.querySelector("[data-avatar-fallback]");
  const avatarInput = document.querySelector("[data-avatar-input]");
  const avatarClear = document.querySelector("[data-avatar-clear]");
  const profileForm = document.querySelector("[data-profile-form]");
  const studioForm = document.querySelector("[data-studio-form]");
  const passwordForm = document.querySelector("[data-password-form]");
  const passwordSection = document.querySelector("[data-settings-password]");
  const passwordReqs = document.querySelector("[data-password-reqs]");
  const newPasswordInput = document.querySelector("#new-password");

  function paintAvatar(acc) {
    const url = acc?.avatarUrl;
    if (url && avatarImg) {
      avatarImg.src = url;
      avatarImg.hidden = false;
      if (avatarFallback) avatarFallback.hidden = true;
    } else {
      if (avatarImg) {
        avatarImg.removeAttribute("src");
        avatarImg.hidden = true;
      }
      if (avatarFallback) {
        avatarFallback.hidden = false;
        avatarFallback.textContent = avatarInitials(acc);
      }
    }
  }

  function fillForms(acc) {
    if (!acc || !profileForm || !studioForm) return;
    profileForm.displayName.value = acc.displayName || "";
    profileForm.username.value = acc.username || "";
    profileForm.email.value = acc.email || "";
    studioForm.defaultTarget.value = acc.defaultTarget || "vocal";
    studioForm.defaultMode.value = acc.defaultMode || "standard";

    const deepOk = canUseMode("deep", acc).ok;
    const deepOpt = studioForm.defaultMode.querySelector('option[value="deep"]');
    if (deepOpt) deepOpt.disabled = !deepOk;
    if (!deepOk && studioForm.defaultMode.value === "deep") {
      studioForm.defaultMode.value = "standard";
    }

    const plan = getPlan(acc);
    const left = analysesRemaining(acc);
    const planLabel = document.querySelector("[data-plan-label]");
    const planLeft = document.querySelector("[data-plan-left]");
    const planNote = document.querySelector("[data-plan-note]");
    if (planLabel) planLabel.textContent = plan.label;
    if (planLeft) planLeft.textContent = left === Infinity ? "Unlimited" : String(left);
    if (planNote) {
      planNote.textContent =
        plan.id === "pro"
          ? "Pro unlocks Deep analysis and higher quotas."
          : "Free includes limited analyses. Upgrade unlocks Deep and more runs.";
    }

    if (passwordSection) {
      passwordSection.hidden = acc.provider !== "password";
    }

    paintAvatar(acc);
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", kind === "error");
    el.classList.toggle("is-ok", kind === "ok");
  }

  fillForms(account);
  void loadShares();

  async function loadShares() {
    const list = document.querySelector("[data-shares-list]");
    const status = document.querySelector("[data-shares-status]");
    if (!list) return;
    try {
      const { listMySharedChains, deleteSharedChain, shareUrl } = await import("../share/chain-share.js");
      const shares = await listMySharedChains();
      if (!shares.length) {
        list.innerHTML = `<p class="settings-hint" data-shares-empty>No shared chains yet. Create one from the studio with <strong>Share link</strong>.</p>`;
        return;
      }
      list.innerHTML = shares
        .map((s) => {
          const title = s.track_name || "Untitled chain";
          const expired = s.expires_at && new Date(s.expires_at).getTime() < Date.now();
          const exp = s.expires_at
            ? expired
              ? "Expired"
              : `Expires ${new Date(s.expires_at).toLocaleDateString()}`
            : "No expiry";
          const created = s.created_at
            ? new Date(s.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "";
          const url = shareUrl(s.id);
          return `<article class="settings-share-row${expired ? " is-expired" : ""}" data-share-id="${s.id}">
            <div class="settings-share-copy">
              <a class="settings-share-title" href="${url}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
              <p class="settings-share-meta">${escapeHtml([created, exp, s.target].filter(Boolean).join(" · "))}</p>
            </div>
            <div class="settings-share-actions">
              <button type="button" class="btn btn-ghost" data-share-copy>Copy link</button>
              <button type="button" class="btn btn-ghost" data-share-delete>Delete</button>
            </div>
          </article>`;
        })
        .join("");

      list.querySelectorAll("[data-share-id]").forEach((row) => {
        const id = row.getAttribute("data-share-id");
        row.querySelector("[data-share-copy]")?.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(shareUrl(id));
            setStatus(status, "Link copied.", "ok");
          } catch {
            setStatus(status, "Couldn’t copy — open the link and copy from the address bar.", "error");
          }
        });
        row.querySelector("[data-share-delete]")?.addEventListener("click", async () => {
          if (!confirm("Delete this share link? Anyone with it will lose access.")) return;
          try {
            await deleteSharedChain(id);
            setStatus(status, "Share deleted.", "ok");
            await loadShares();
          } catch (err) {
            setStatus(status, err.message || "Couldn’t delete.", "error");
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="settings-hint">${escapeHtml(err.message || "Couldn’t load shares.")}</p>`;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  avatarInput?.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    avatarInput.value = "";
    if (!file) return;
    const status = document.querySelector("[data-profile-status]");
    setStatus(status, "Uploading photo…");
    try {
      const next = await updateAvatar(file);
      fillForms(next);
      setStatus(status, "Photo updated.", "ok");
      await mountAuthNav(document.querySelector("[data-auth-nav]"), navOpts);
    } catch (err) {
      setStatus(status, err.message || "Couldn’t update photo.", "error");
    }
  });

  avatarClear?.addEventListener("click", async () => {
    const status = document.querySelector("[data-profile-status]");
    setStatus(status, "Removing…");
    try {
      const next = await clearAvatar();
      fillForms(next);
      setStatus(status, "Photo removed.", "ok");
      await mountAuthNav(document.querySelector("[data-auth-nav]"), navOpts);
    } catch (err) {
      setStatus(status, err.message || "Couldn’t remove photo.", "error");
    }
  });

  profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.querySelector("[data-profile-status]");
    const btn = document.querySelector("[data-profile-save]");
    const fd = new FormData(profileForm);
    if (btn) btn.disabled = true;
    setStatus(status, "Saving…");
    try {
      const next = await updateAccount({
        displayName: String(fd.get("displayName") || ""),
        username: String(fd.get("username") || ""),
      });
      fillForms(next);
      setStatus(status, "Profile saved.", "ok");
      await mountAuthNav(document.querySelector("[data-auth-nav]"), navOpts);
    } catch (err) {
      setStatus(status, err.message || "Couldn’t save profile.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  studioForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.querySelector("[data-studio-status]");
    const btn = document.querySelector("[data-studio-save]");
    const fd = new FormData(studioForm);
    let mode = String(fd.get("defaultMode") || "standard");
    if (mode === "deep" && !canUseMode("deep").ok) mode = "standard";
    if (btn) btn.disabled = true;
    setStatus(status, "Saving…");
    try {
      const next = await updateAccount({
        defaultTarget: String(fd.get("defaultTarget") || "vocal"),
        defaultMode: mode,
      });
      fillForms(next);
      setStatus(status, "Defaults saved.", "ok");
    } catch (err) {
      setStatus(status, err.message || "Couldn’t save defaults.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  function syncPasswordReqs(value) {
    if (!passwordReqs) return;
    const { checks } = validatePassword(value);
    passwordReqs.querySelectorAll("[data-req]").forEach((el) => {
      const key = el.getAttribute("data-req");
      el.classList.toggle("is-met", Boolean(checks[key]));
    });
  }

  newPasswordInput?.addEventListener("focus", () => {
    if (!passwordReqs) return;
    passwordReqs.hidden = false;
    passwordReqs.classList.add("is-open");
    syncPasswordReqs(newPasswordInput.value || "");
  });

  newPasswordInput?.addEventListener("input", () => {
    if (!passwordReqs) return;
    passwordReqs.hidden = false;
    passwordReqs.classList.add("is-open");
    syncPasswordReqs(newPasswordInput.value || "");
  });

  passwordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.querySelector("[data-password-status]");
    const fd = new FormData(passwordForm);
    const currentPassword = String(fd.get("currentPassword") || "");
    const newPassword = String(fd.get("newPassword") || "");
    const confirmPassword = String(fd.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setStatus(status, "New passwords don’t match.", "error");
      return;
    }
    const btn = passwordForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    setStatus(status, "Updating…");
    try {
      await changePassword({ currentPassword, newPassword });
      passwordForm.reset();
      if (passwordReqs) {
        passwordReqs.hidden = true;
        passwordReqs.classList.remove("is-open");
      }
      setStatus(status, "Password updated.", "ok");
    } catch (err) {
      setStatus(status, err.message || "Couldn’t change password.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
