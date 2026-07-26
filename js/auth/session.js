/**
 * Account session — Supabase Postgres when configured, else local demo store.
 * Public API: initAuth, getSession, signup, login, loginWithSocial, logout, updateAccount.
 */

import { isSupabaseConfigured } from "./config.js";
import { getSupabase } from "./supabase-client.js";
import { validatePassword, validateUsername, looksLikeEmail } from "./validation.js";

const USERS_KEY = "chainprint.users.v2";
const SESSION_KEY = "chainprint.session.v2";
const ACCOUNT_CACHE_KEY = "chainprint.account.v2";
const USERS_KEY_V1 = "chainprint.users.v1";
const SESSION_KEY_V1 = "chainprint.session.v1";

/** @typedef {'free' | 'pro'} PlanId */
/** @typedef {'password' | 'google' | 'apple'} AuthProvider */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string} email
 * @property {string} username
 * @property {string} name
 * @property {string | null} [displayName]
 * @property {string | null} [avatarUrl]
 * @property {'vocal' | 'instrumental' | 'full'} [defaultTarget]
 * @property {'standard' | 'deep'} [defaultMode]
 * @property {string | null} [passwordHash]
 * @property {AuthProvider} provider
 * @property {string | null} providerUserId
 * @property {PlanId} plan
 * @property {number} analysesUsed
 * @property {number | null} analysesIncluded
 * @property {string} createdAt
 */

/** @type {Account | null} */
let memoryAccount = null;
/** @type {Promise<Account | null> | null} */
let initPromise = null;
let migrated = false;

function cacheAccount(account) {
  memoryAccount = account ? publicAccount(account) : null;
  if (memoryAccount) {
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(memoryAccount));
  } else {
    localStorage.removeItem(ACCOUNT_CACHE_KEY);
  }
  return memoryAccount;
}

function readCachedAccount() {
  if (memoryAccount) return memoryAccount;
  try {
    const raw = localStorage.getItem(ACCOUNT_CACHE_KEY);
    if (!raw) return null;
    memoryAccount = JSON.parse(raw);
    return memoryAccount;
  } catch {
    return null;
  }
}

/** @param {Account} account */
function publicAccount(account) {
  const { passwordHash, ...rest } = account;
  const username = rest.username || rest.name || rest.email?.split("@")[0] || "user";
  return {
    ...rest,
    username,
    name: rest.displayName || rest.name || username,
    displayName: rest.displayName || null,
    avatarUrl: rest.avatarUrl || null,
    defaultTarget: normalizeTarget(rest.defaultTarget),
    defaultMode: normalizeMode(rest.defaultMode),
  };
}

function normalizeTarget(t) {
  return t === "instrumental" || t === "full" ? t : "vocal";
}

function normalizeMode(m) {
  return m === "deep" ? "deep" : "standard";
}

/** Pull forward accounts created before username / v2 storage. */
function migrateLegacyUsers() {
  if (migrated) return;
  migrated = true;

  try {
    const existing = localStorage.getItem(USERS_KEY);
    if (existing && existing !== "{}") {
      // Still adopt session if only session stayed on v1
      if (!localStorage.getItem(SESSION_KEY)) {
        const oldSession = localStorage.getItem(SESSION_KEY_V1);
        if (oldSession) localStorage.setItem(SESSION_KEY, oldSession);
      }
      return;
    }

    const raw = localStorage.getItem(USERS_KEY_V1);
    if (!raw) return;
    const oldUsers = JSON.parse(raw);
    if (!oldUsers || typeof oldUsers !== "object") return;

    const users = {};
    const usedNames = new Set();

    for (const [emailKey, account] of Object.entries(oldUsers)) {
      if (!account || typeof account !== "object") continue;
      const email = String(account.email || emailKey || "")
        .trim()
        .toLowerCase();
      if (!email) continue;

      let base =
        String(account.username || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "") ||
        String(account.name || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "") ||
        email.split("@")[0].replace(/[^a-z0-9_]/g, "") ||
        "user";
      if (base.length < 3) base = `${base}123`.slice(0, 24);
      base = base.slice(0, 24);

      let username = base;
      let n = 0;
      while (usedNames.has(username)) {
        n += 1;
        const suffix = String(n);
        username = `${base.slice(0, Math.max(1, 24 - suffix.length))}${suffix}`;
      }
      usedNames.add(username);

      users[email] = {
        ...account,
        email,
        username,
        name: username,
        plan: account.plan || "free",
        analysesUsed: Number(account.analysesUsed || 0),
        analysesIncluded: account.analysesIncluded ?? null,
      };
    }

    localStorage.setItem(USERS_KEY, JSON.stringify(users));

    const oldSession = localStorage.getItem(SESSION_KEY_V1);
    if (oldSession && !localStorage.getItem(SESSION_KEY)) {
      localStorage.setItem(SESSION_KEY, oldSession);
    }
  } catch (err) {
    console.warn("[auth] legacy migrate failed", err);
  }
}

function readUsers() {
  migrateLegacyUsers();
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(`chainprint:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function uid() {
  return crypto.randomUUID?.() || `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function newFreeAccount({
  email,
  username,
  passwordHash = null,
  provider = "password",
  providerUserId = null,
  id = null,
}) {
  const uname = String(username || email.split("@")[0] || "user").trim();
  return {
    id: id || uid(),
    email,
    username: uname,
    name: uname,
    displayName: null,
    avatarUrl: null,
    defaultTarget: /** @type {'vocal'} */ ("vocal"),
    defaultMode: /** @type {'standard'} */ ("standard"),
    passwordHash,
    provider,
    providerUserId,
    plan: /** @type {PlanId} */ ("free"),
    analysesUsed: 0,
    analysesIncluded: null,
    createdAt: new Date().toISOString(),
  };
}

function mapProfileRow(user, profile) {
  const username = profile?.username || user.user_metadata?.username || user.email?.split("@")[0] || "user";
  const displayName = profile?.display_name || null;
  return publicAccount({
    id: user.id,
    email: profile?.email || user.email || "",
    username,
    name: displayName || username,
    displayName,
    avatarUrl: profile?.avatar_url || null,
    defaultTarget: normalizeTarget(profile?.default_target),
    defaultMode: normalizeMode(profile?.default_mode),
    passwordHash: null,
    provider: /** @type {AuthProvider} */ (profile?.provider || "password"),
    providerUserId: null,
    plan: /** @type {PlanId} */ (profile?.plan || "free"),
    analysesUsed: Number(profile?.analyses_used || 0),
    analysesIncluded: profile?.analyses_included ?? null,
    createdAt: profile?.created_at || user.created_at || new Date().toISOString(),
  });
}

/** Warm session cache (call once per page). */
export async function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isSupabaseConfigured()) {
      return getSession();
    }

    try {
      const supabase = await getSupabase();
      if (!supabase) return getSession();

      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.user) {
        cacheAccount(null);
        return null;
      }

      const profile = await fetchProfile(supabase, data.session.user.id);
      return cacheAccount(mapProfileRow(data.session.user, profile));
    } catch (err) {
      console.warn("[auth] init failed", err);
      return getSession();
    }
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/** @returns {Account | null} */
export function getSession() {
  if (isSupabaseConfigured()) {
    return readCachedAccount();
  }

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      cacheAccount(null);
      return null;
    }
    const { email } = JSON.parse(raw);
    const users = readUsers();
    const key = String(email || "").toLowerCase();
    const account = users[key];
    if (!account) {
      cacheAccount(null);
      return null;
    }
    return cacheAccount(publicAccount(account));
  } catch {
    cacheAccount(null);
    return null;
  }
}

/** Drop persisted Supabase auth keys so a failed/hung signOut can't revive the session. */
function clearSupabaseAuthStorage() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const doomed = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key) continue;
        if (key.startsWith("sb-") && key.includes("auth")) doomed.push(key);
      }
      for (const key of doomed) store.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export async function logout() {
  cacheAccount(null);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY_V1);
  localStorage.removeItem(ACCOUNT_CACHE_KEY);
  initPromise = null;
  // Wipe tokens first so a mid-flight getSession can't revive the user
  clearSupabaseAuthStorage();

  if (!isSupabaseConfigured()) return;

  try {
    const supabase = await getSupabase();
    await Promise.race([
      supabase?.auth.signOut({ scope: "local" }) ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* ignore — storage already cleared */
  }
  clearSupabaseAuthStorage();
  cacheAccount(null);
}

/**
 * @param {{ email: string, password: string, username: string }} input
 * @returns {Promise<Account>}
 */
export async function signup({ email, password, username }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw Object.assign(new Error("Enter a valid email."), { code: "invalid_email" });
  }

  const userCheck = validateUsername(username);
  if (!userCheck.ok) {
    throw Object.assign(new Error(userCheck.message), { code: "invalid_username" });
  }

  const passCheck = validatePassword(password);
  if (!passCheck.ok) {
    throw Object.assign(new Error(passCheck.message), { code: "weak_password" });
  }

  if (isSupabaseConfigured()) {
    return signupRemote({
      email: normalizedEmail,
      password,
      username: userCheck.normalized,
    });
  }

  return signupLocal({
    email: normalizedEmail,
    password,
    username: userCheck.normalized,
  });
}

/**
 * @param {{ email?: string, identifier?: string, password: string }} input
 * @returns {Promise<Account>}
 */
export async function login({ email, identifier, password }) {
  const rawId = String(identifier || email || "").trim();
  if (!rawId) {
    throw Object.assign(new Error("Enter your email or username."), { code: "invalid_login" });
  }
  if (!password) {
    throw Object.assign(new Error("Enter your password."), { code: "weak_password" });
  }

  if (isSupabaseConfigured()) {
    return loginRemote({ identifier: rawId, password });
  }
  return loginLocal({ identifier: rawId, password });
}

/**
 * Create or resume an account from Google / Apple (local / demo path).
 * @param {{ provider: 'google' | 'apple', email: string, name?: string, providerUserId: string }} input
 */
export async function loginWithSocial({ provider, email, name, providerUserId }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw Object.assign(new Error("That provider didn’t return an email."), { code: "no_email" });
  }

  if (isSupabaseConfigured()) {
    throw Object.assign(
      new Error("Connect Google / Apple in the Supabase dashboard, then use those buttons."),
      { code: "oauth_pending" }
    );
  }

  const users = readUsers();
  let account = users[normalized];
  const baseUser =
    String(name || "").trim().replace(/\s+/g, "_").slice(0, 24) ||
    normalized.split("@")[0];

  if (!account) {
    let username = baseUser.replace(/[^a-zA-Z0-9_]/g, "") || "user";
    if (username.length < 3) username = `${username}123`.slice(0, 24);
    username = uniqueLocalUsername(username, users);
    account = newFreeAccount({
      email: normalized,
      username,
      passwordHash: null,
      provider,
      providerUserId: providerUserId || null,
    });
    users[normalized] = account;
    writeUsers(users);
  } else {
    account.provider = account.provider || provider;
    account.providerUserId = account.providerUserId || providerUserId || null;
    users[normalized] = account;
    writeUsers(users);
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify({ email: normalized, at: Date.now() }));
  return cacheAccount(account);
}

/** Persist mutable fields on the signed-in account. */
export async function updateAccount(patch) {
  const session = getSession();
  if (!session) return null;

  const next = { ...session, ...patch, passwordHash: null };
  if (patch.displayName !== undefined) {
    const dn = String(patch.displayName || "").trim().slice(0, 40);
    next.displayName = dn || null;
    next.name = dn || next.username;
  }
  if (patch.defaultTarget != null) next.defaultTarget = normalizeTarget(patch.defaultTarget);
  if (patch.defaultMode != null) next.defaultMode = normalizeMode(patch.defaultMode);
  if (patch.username != null) {
    const check = validateUsername(patch.username);
    if (!check.ok) {
      throw Object.assign(new Error(check.message), { code: "invalid_username" });
    }
    next.username = check.normalized;
    if (!next.displayName) next.name = check.normalized;
  }

  const optimistic = publicAccount(next);
  cacheAccount(optimistic);

  if (isSupabaseConfigured()) {
    const supabase = await getSupabase();
    if (!supabase) return optimistic;
    const row = {};
    if (patch.plan != null) row.plan = patch.plan;
    if (patch.analysesUsed != null) row.analyses_used = patch.analysesUsed;
    if (patch.analysesIncluded != null) row.analyses_included = patch.analysesIncluded;
    if (patch.username != null) row.username = optimistic.username;
    if (patch.displayName !== undefined) row.display_name = optimistic.displayName;
    if (patch.avatarUrl !== undefined) row.avatar_url = optimistic.avatarUrl;
    if (patch.defaultTarget != null) row.default_target = optimistic.defaultTarget;
    if (patch.defaultMode != null) row.default_mode = optimistic.defaultMode;

    if (patch.username != null && patch.username !== session.username) {
      const { data: taken, error: takenErr } = await supabase.rpc("username_taken", {
        u: optimistic.username,
      });
      if (!takenErr && taken) {
        cacheAccount(session);
        throw Object.assign(new Error("That username is taken. Try another."), {
          code: "username_taken",
        });
      }
    }

    if (Object.keys(row).length) {
      const { error } = await supabase.from("profiles").update(row).eq("id", session.id);
      if (error) {
        cacheAccount(session);
        if (/unique|duplicate/i.test(error.message || "")) {
          throw Object.assign(new Error("That username is taken. Try another."), {
            code: "username_taken",
          });
        }
        throw Object.assign(new Error(error.message || "Couldn’t save settings."), {
          code: "update_failed",
        });
      }
    }
    return optimistic;
  }

  const users = readUsers();
  const account = users[session.email];
  if (!account) return null;
  if (patch.username != null && patch.username !== session.username) {
    if (findByUsername(users, optimistic.username) && findByUsername(users, optimistic.username).email !== session.email) {
      cacheAccount(session);
      throw Object.assign(new Error("That username is taken. Try another."), {
        code: "username_taken",
      });
    }
  }
  Object.assign(account, {
    username: optimistic.username,
    name: optimistic.name,
    displayName: optimistic.displayName,
    avatarUrl: optimistic.avatarUrl,
    defaultTarget: optimistic.defaultTarget,
    defaultMode: optimistic.defaultMode,
    plan: optimistic.plan,
    analysesUsed: optimistic.analysesUsed,
    analysesIncluded: optimistic.analysesIncluded,
  });
  users[session.email] = account;
  writeUsers(users);
  return cacheAccount(account);
}

/**
 * Upload / replace profile photo. Uses Storage when available, else data URL on profile.
 * @param {File} file
 */
export async function updateAvatar(file) {
  const session = getSession();
  if (!session) throw Object.assign(new Error("Sign in to update your photo."), { code: "auth" });

  const { compressAvatar } = await import("./avatar.js");
  const { dataUrl, blob } = await compressAvatar(file);
  let avatarUrl = dataUrl;

  if (isSupabaseConfigured()) {
    const supabase = await getSupabase();
    if (supabase) {
      const path = `${session.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: "3600",
      });
      if (!upErr) {
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        avatarUrl = `${data.publicUrl}?t=${Date.now()}`;
      }
      // If bucket missing / policy fail, fall back to data URL on the profile row
    }
  }

  return updateAccount({ avatarUrl });
}

/** Remove profile photo. */
export async function clearAvatar() {
  const session = getSession();
  if (!session) return null;

  if (isSupabaseConfigured()) {
    const supabase = await getSupabase();
    if (supabase) {
      await supabase.storage.from("avatars").remove([`${session.id}/avatar.jpg`]);
    }
  }
  return updateAccount({ avatarUrl: null });
}

/**
 * Change password for password-provider accounts.
 * @param {{ currentPassword: string, newPassword: string }} input
 */
export async function changePassword({ currentPassword, newPassword }) {
  const session = getSession();
  if (!session) throw Object.assign(new Error("Sign in first."), { code: "auth" });
  if (session.provider !== "password") {
    throw Object.assign(new Error("This account uses social sign-in — change the password with that provider."), {
      code: "oauth_only",
    });
  }

  const pass = validatePassword(newPassword);
  if (!pass.ok) throw Object.assign(new Error(pass.message), { code: "weak_password" });

  if (isSupabaseConfigured()) {
    const supabase = await getSupabase();
    if (!supabase) throw new Error("Database is not configured.");
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: session.email,
      password: currentPassword,
    });
    if (signErr) {
      throw Object.assign(new Error("Current password is incorrect."), { code: "bad_password" });
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw Object.assign(new Error(error.message || "Couldn’t update password."), {
        code: "update_failed",
      });
    }
    return true;
  }

  const users = readUsers();
  const account = users[session.email];
  if (!account?.passwordHash) {
    throw Object.assign(new Error("No password on this account."), { code: "oauth_only" });
  }
  const currentHash = await hashPassword(currentPassword);
  if (currentHash !== account.passwordHash) {
    throw Object.assign(new Error("Current password is incorrect."), { code: "bad_password" });
  }
  account.passwordHash = await hashPassword(newPassword);
  users[session.email] = account;
  writeUsers(users);
  return true;
}

/* ——— Local store ——— */

async function signupLocal({ email, password, username }) {
  const users = readUsers();
  if (users[email]) {
    throw Object.assign(new Error("An account with that email already exists. Log in instead."), {
      code: "exists",
    });
  }
  if (findByUsername(users, username)) {
    throw Object.assign(new Error("That username is taken. Try another."), { code: "username_taken" });
  }

  const account = newFreeAccount({
    email,
    username,
    passwordHash: await hashPassword(password),
    provider: "password",
  });
  users[email] = account;
  writeUsers(users);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email, at: Date.now() }));
  return cacheAccount(account);
}

async function loginLocal({ identifier, password }) {
  const users = readUsers();
  const id = identifier.trim();
  let account = null;

  if (looksLikeEmail(id)) {
    account = users[id.toLowerCase()] || null;
  } else {
    account = findByUsername(users, id);
  }

  if (!account) {
    throw Object.assign(
      new Error(
        isSupabaseConfigured()
          ? "No account found for that email or username."
          : "No account found in this browser. Create an account here, or use the same browser where you signed up (accounts aren’t synced yet)."
      ),
      { code: "not_found" }
    );
  }
  if (!account.passwordHash) {
    throw Object.assign(
      new Error(`This account uses ${account.provider === "apple" ? "Apple" : "Google"} sign-in.`),
      { code: "oauth_only" }
    );
  }
  const hash = await hashPassword(password);
  if (hash !== account.passwordHash) {
    throw Object.assign(new Error("Incorrect password."), { code: "bad_password" });
  }
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ email: account.email.toLowerCase(), at: Date.now() })
  );
  return cacheAccount(account);
}

function findByUsername(users, username) {
  const needle = String(username || "").trim().toLowerCase();
  return Object.values(users).find((a) => String(a.username || "").toLowerCase() === needle) || null;
}

function uniqueLocalUsername(base, users) {
  let candidate = base.slice(0, 24);
  let n = 0;
  while (findByUsername(users, candidate)) {
    n += 1;
    const suffix = String(n);
    candidate = `${base.slice(0, Math.max(1, 24 - suffix.length))}${suffix}`;
  }
  return candidate;
}

/* ——— Supabase ——— */

async function fetchProfile(supabase, userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    console.warn("[auth] profile fetch", error);
    return null;
  }
  return data;
}

async function signupRemote({ email, password, username }) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Database is not configured.");

  const { data: taken, error: takenErr } = await supabase.rpc("username_taken", {
    u: username,
  });
  if (!takenErr && taken) {
    throw Object.assign(new Error("That username is taken. Try another."), { code: "username_taken" });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
    },
  });

  if (error) {
    const msg = error.message || "Couldn’t create account.";
    if (/already/i.test(msg)) {
      throw Object.assign(new Error("An account with that email already exists. Log in instead."), {
        code: "exists",
      });
    }
    throw Object.assign(new Error(msg), { code: "signup_failed" });
  }

  const user = data.user;
  if (!user) {
    throw Object.assign(
      new Error("Check your email to confirm the account, then log in."),
      { code: "confirm_email" }
    );
  }

  // Profile row is created by DB trigger on auth.users. With a session we can
  // upsert / ensure; without one (email confirm on), skip client insert — RLS
  // would block auth.uid() = null.
  if (data.session) {
    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        email,
        username,
        provider: "password",
        plan: "free",
        analyses_used: 0,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      if (/unique|duplicate/i.test(profileError.message || "")) {
        throw Object.assign(new Error("That username or email is already taken."), {
          code: "exists",
        });
      }
      const { error: ensureErr } = await supabase.rpc("ensure_own_profile", {
        p_username: username,
      });
      if (ensureErr) {
        throw Object.assign(
          new Error(profileError.message || "Couldn’t save profile."),
          { code: "profile_failed" }
        );
      }
    }

    const profile = await fetchProfile(supabase, user.id);
    return cacheAccount(mapProfileRow(user, profile));
  }

  throw Object.assign(
    new Error("Account created. Confirm your email, then log in."),
    { code: "confirm_email" }
  );
}

async function loginRemote({ identifier, password }) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Database is not configured.");

  let email = identifier.trim().toLowerCase();
  if (!looksLikeEmail(email)) {
    const { data, error } = await supabase.rpc("resolve_login_email", {
      identifier: email,
    });
    if (error || !data) {
      throw Object.assign(new Error("No account found for that email or username."), {
        code: "not_found",
      });
    }
    email = String(data).toLowerCase();
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw Object.assign(new Error("Incorrect email/username or password."), {
      code: "bad_password",
    });
  }

  const user = data.user;
  if (!user) {
    throw Object.assign(new Error("Login failed."), { code: "login_failed" });
  }

  let profile = await fetchProfile(supabase, user.id);
  if (!profile) {
    const uname =
      user.user_metadata?.username ||
      email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24) ||
      "user";
    const safeName = uname.length >= 3 ? uname : `${uname}123`.slice(0, 24);
    const { error: upsertErr } = await supabase.from("profiles").upsert({
      id: user.id,
      email,
      username: safeName,
      provider: "password",
      plan: "free",
      analyses_used: 0,
    });
    if (upsertErr) {
      await supabase.rpc("ensure_own_profile", { p_username: safeName });
    }
    profile = await fetchProfile(supabase, user.id);
  }

  return cacheAccount(mapProfileRow(user, profile));
}
