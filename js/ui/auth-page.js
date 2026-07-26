/**
 * Signup / login page.
 */

import { getSession, login, signup } from "../auth/session.js";
import { signInWithProvider, socialStatus } from "../auth/oauth.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") === "login" ? "login" : "signup";
const nextRaw = params.get("next") || "/analyze/";
const next = safeNext(nextRaw);

const titleEl = document.querySelector("[data-auth-title]");
const ledeEl = document.querySelector("[data-auth-lede]");
const nameField = document.querySelector("[data-name-field]");
const form = document.querySelector("[data-auth-form]");
const errorEl = document.querySelector("[data-auth-error]");
const submitBtn = document.querySelector("[data-auth-submit]");
const switchEl = document.querySelector("[data-auth-switch]");
const passwordInput = form?.querySelector("#password");
const socialNote = document.querySelector("[data-social-note]");

if (getSession()) {
  location.replace(next);
}

function safeNext(path) {
  const map = {
    "/": "../",
    "/analyze": "../analyze/",
    "/analyze/": "../analyze/",
    "/calibration": "../calibration/",
    "/calibration/": "../calibration/",
    "analyze": "../analyze/",
    "analyze/": "../analyze/",
  };
  if (map[path]) return map[path];
  // Same-origin relative only — block open redirects
  if (
    typeof path === "string" &&
    /^\.\.?\//.test(path) &&
    !path.includes("//") &&
    !/[\\:]/.test(path)
  ) {
    return path;
  }
  return "../analyze/";
}

function switchHref(targetMode) {
  return `?mode=${targetMode}&next=${encodeURIComponent(nextRaw)}`;
}

function setMode(m) {
  const isLogin = m === "login";
  document.title = isLogin ? "Log in · CHAINPRINT" : "Sign up · CHAINPRINT";
  if (titleEl) titleEl.textContent = isLogin ? "Welcome back" : "Create your account";
  if (ledeEl) {
    ledeEl.textContent = isLogin
      ? "Log in to continue reverse-engineering vocal mixes in your DAW."
      : "Sign up to analyze a reference mix and recreate the vocal chain in your DAW.";
  }
  if (nameField) nameField.hidden = isLogin;
  if (passwordInput) {
    passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  }
  if (submitBtn) submitBtn.textContent = isLogin ? "Log in" : "Sign up with email";
  if (switchEl) {
    switchEl.innerHTML = isLogin
      ? `New here? <a href="${switchHref("signup")}">Create an account</a>`
      : `Already have an account? <a href="${switchHref("login")}">Log in</a>`;
  }
}

function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg || "";
  errorEl.classList.toggle("is-visible", Boolean(msg));
}

const status = socialStatus();
if (socialNote && status.demo) {
  socialNote.textContent = "Local demo: Google / Apple sign in without Client IDs. Add IDs in js/auth/config.js for production.";
  socialNote.classList.remove("hidden");
}

setMode(mode);

document.querySelectorAll("[data-social]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const provider = btn.getAttribute("data-social");
    if (provider !== "google" && provider !== "apple") return;
    showError("");
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Connecting…";
    try {
      await signInWithProvider(provider);
      location.assign(next);
    } catch (err) {
      if (err.code !== "cancelled") {
        showError(err.message || "Social sign-in failed.");
      }
      btn.disabled = false;
      btn.textContent = label;
      // restore icon+label properly
      btn.innerHTML =
        provider === "google"
          ? `<span class="social-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="#EA4335" d="M12 10.2v3.6h5.1c-.2 1.2-.9 2.3-1.9 3l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.3-.2-1.9H12z"/><path fill="#34A853" d="M6.6 14.3l-.7.5-2.4 1.9C5.1 19.3 8.3 21.2 12 21.2c2.4 0 4.4-.8 5.9-2.1l-3.1-2.4c-.8.6-1.9.9-2.8.9-2.2 0-4-1.5-4.7-3.5z"/><path fill="#4A90E2" d="M3.5 7.3C2.7 8.8 2.3 10.4 2.3 12s.5 3.2 1.2 4.7c0 0 0 0 0 0l3.1-2.4c-.2-.5-.3-1.1-.3-1.7s.1-1.2.3-1.7L3.5 7.3z"/><path fill="#FBBC05" d="M12 5.4c1.3 0 2.5.5 3.4 1.3l2.6-2.6C16.4 2.6 14.4 1.8 12 1.8 8.3 1.8 5.1 3.7 3.5 7.3l3.1 2.4C7.9 7.7 9.8 5.4 12 5.4z"/></svg></span> Continue with Google`
          : `<span class="social-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.7 12.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8-.6 0-1.6-.7-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.3.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.3-.1 0-2.1-.8-2.2-3.5zM14.4 6.5c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1 1.6-.9 2.5 1 .1 1.9-.5 2.5-1.1z"/></svg></span> Continue with Apple`;
    }
  });
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const fd = new FormData(form);
  const email = String(fd.get("email") || "");
  const password = String(fd.get("password") || "");
  const name = String(fd.get("name") || "");

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = mode === "login" ? "Logging in…" : "Creating account…";
  }

  try {
    if (mode === "login") await login({ email, password });
    else await signup({ email, password, name });
    location.assign(next);
  } catch (err) {
    showError(err.message || "Something went wrong.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === "login" ? "Log in" : "Sign up with email";
    }
  }
});
