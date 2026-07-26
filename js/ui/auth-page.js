/**
 * Signup / login page.
 */

import { getSession, initAuth, login, signup } from "../auth/session.js";
import { signInWithProvider, socialStatus } from "../auth/oauth.js";
import { validatePassword } from "../auth/validation.js";
import { isSupabaseConfigured } from "../auth/config.js";

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
const emailInput = form?.querySelector("#email");
const emailLabel = form?.querySelector('label[for="email"]');
const requirements = document.querySelector("[data-password-reqs]");
const socialNote = document.querySelector("[data-social-note]");
const dbNote = document.querySelector("[data-db-note]");

await initAuth();

if (getSession()) {
  location.replace(next);
}

function safeNext(path) {
  const map = {
    "/": "../",
    "/analyze": "../analyze/",
    "/analyze/": "../analyze/",
    "/find": "../find/",
    "/find/": "../find/",
    "/calibration": "../calibration/",
    "/calibration/": "../calibration/",
    analyze: "../analyze/",
    "analyze/": "../analyze/",
    find: "../find/",
    "find/": "../find/",
  };
  if (map[path]) return map[path];
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

function syncPasswordReqs(value) {
  if (!requirements) return;
  const { checks } = validatePassword(value);
  requirements.querySelectorAll("[data-req]").forEach((el) => {
    const key = el.getAttribute("data-req");
    el.classList.toggle("is-met", Boolean(checks[key]));
  });
}

function setPasswordReqsVisible(on) {
  if (!requirements) return;
  requirements.hidden = !on;
  requirements.classList.toggle("is-open", on);
}

function setMode(m) {
  const isLogin = m === "login";
  document.title = isLogin ? "Log in · Chainprint" : "Sign up · Chainprint";
  if (titleEl) titleEl.textContent = isLogin ? "Welcome back" : "Create your account";
  if (ledeEl) {
    ledeEl.textContent = isLogin
      ? "Log in with your email or username to continue."
      : "Choose a username and password to analyze vocal mixes in your DAW.";
  }
  if (nameField) {
    nameField.hidden = isLogin;
    const input = nameField.querySelector("input");
    if (input) input.required = !isLogin;
  }
  if (emailLabel) {
    emailLabel.textContent = isLogin ? "Email or username" : "Email";
  }
  if (emailInput) {
    emailInput.type = isLogin ? "text" : "email";
    emailInput.autocomplete = isLogin ? "username" : "email";
    emailInput.placeholder = isLogin ? "you@studio.com or username" : "you@studio.com";
    emailInput.name = isLogin ? "identifier" : "email";
  }
  if (passwordInput) {
    passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
    passwordInput.placeholder = isLogin ? "Your password" : "Create a password";
    passwordInput.minLength = isLogin ? 1 : 8;
  }
  // Never show password rules on login; signup shows them while creating a password
  setPasswordReqsVisible(false);
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

if (dbNote) {
  if (!isSupabaseConfigured()) {
    dbNote.textContent =
      "Accounts stay on this device until the cloud database is connected. Signing up on your phone won’t see a desktop account yet.";
    dbNote.classList.remove("hidden");
  } else {
    dbNote.classList.add("hidden");
  }
}

const status = socialStatus();
if (socialNote) {
  if (status.demo) {
    socialNote.textContent =
      "Local demo: Google / Apple work without Client IDs here. Production needs IDs in js/auth/config.js.";
    socialNote.classList.remove("hidden");
  } else if (!status.google && !status.apple) {
    socialNote.textContent =
      "Email signup works now. Google / Apple sign-in unlock once OAuth Client IDs are added.";
    socialNote.classList.remove("hidden");
  } else if (status.google && !status.apple) {
    socialNote.textContent = "Apple Sign In needs an Apple Developer Services ID (optional).";
    socialNote.classList.remove("hidden");
  }
}

setMode(mode);

passwordInput?.addEventListener("focus", () => {
  if (mode !== "signup") return;
  setPasswordReqsVisible(true);
  syncPasswordReqs(passwordInput.value || "");
});

passwordInput?.addEventListener("input", () => {
  if (mode !== "signup") {
    setPasswordReqsVisible(false);
    return;
  }
  setPasswordReqsVisible(true);
  syncPasswordReqs(passwordInput.value);
});

passwordInput?.addEventListener("blur", () => {
  if (mode !== "signup") {
    setPasswordReqsVisible(false);
    return;
  }
  // Keep checklist open if they started typing so they can finish the password
  if (!passwordInput.value) setPasswordReqsVisible(false);
});

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
  const password = String(fd.get("password") || "");
  const username = String(fd.get("username") || "");
  const identifier = String(fd.get("identifier") || fd.get("email") || "");
  const email = String(fd.get("email") || identifier || "");

  if (mode === "signup") {
    const pass = validatePassword(password);
    if (!pass.ok) {
      showError(pass.message);
      return;
    }
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = mode === "login" ? "Logging in…" : "Creating account…";
  }

  try {
    if (mode === "login") await login({ identifier, password });
    else await signup({ email, password, username });
    location.assign(next);
  } catch (err) {
    showError(err.message || "Something went wrong.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === "login" ? "Log in" : "Sign up with email";
    }
  }
});
