/**
 * Local account store — prototype auth until a real provider is wired.
 * Same API surface can later talk to Supabase / Clerk / custom backend.
 */

const USERS_KEY = "chainprint.users.v1";
const SESSION_KEY = "chainprint.session.v1";

/** @typedef {'free' | 'pro'} PlanId */
/** @typedef {'password' | 'google' | 'apple'} AuthProvider */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string} email
 * @property {string} name
 * @property {string | null} passwordHash
 * @property {AuthProvider} provider
 * @property {string | null} providerUserId
 * @property {PlanId} plan
 * @property {number} analysesUsed
 * @property {number} analysesIncluded
 * @property {string} createdAt
 */

function readUsers() {
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

function newFreeAccount({ email, name, passwordHash = null, provider = "password", providerUserId = null }) {
  return {
    id: uid(),
    email,
    name: displayNameFrom(email, name),
    passwordHash,
    provider,
    providerUserId,
    plan: "free",
    analysesUsed: 0,
    // null → use PLANS.free.analysesIncluded at read time
    analysesIncluded: null,
    createdAt: new Date().toISOString(),
  };
}

const PLACEHOLDER_NAMES = new Set(["google user", "apple user", "google", "apple"]);

/** Demo social profiles (no Client ID) — person names for UI, not email stubs */
const DEMO_DISPLAY_NAMES = {
  "demo.google@chainprint.local": "Alex Morgan",
  "demo.apple@chainprint.local": "Sam Rivera",
};

function isStubName(name, email) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return true;
  if (PLACEHOLDER_NAMES.has(n)) return true;
  const local = String(email || "").split("@")[0].toLowerCase();
  if (n === local) return true;
  if (local.startsWith("demo.") && n === local.slice(5)) return true;
  return false;
}

function displayNameFrom(email, name) {
  const trimmed = String(name || "").trim();
  if (trimmed && !isStubName(trimmed, email)) return trimmed;

  const key = String(email || "").trim().toLowerCase();
  if (DEMO_DISPLAY_NAMES[key]) return DEMO_DISPLAY_NAMES[key];

  const local = key.split("@")[0] || "Account";
  if (local.startsWith("demo.")) {
    return local.slice(5).replace(/\./g, " ") || "Account";
  }
  return local;
}

/** @returns {Account | null} */
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { email } = JSON.parse(raw);
    const users = readUsers();
    const key = email?.toLowerCase?.();
    const account = users[key];
    if (!account) return null;

    // Migrate leftover placeholder display names from earlier demo auth
    const cleaned = displayNameFrom(account.email, account.name);
    if (cleaned !== account.name) {
      account.name = cleaned;
      users[key] = account;
      writeUsers(users);
    }

    return publicAccount(account);
  } catch {
    return null;
  }
}

/** @param {Account} account */
function publicAccount(account) {
  const { passwordHash, ...rest } = account;
  return rest;
}

function setSession(email) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email: email.toLowerCase(), at: Date.now() }));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * @param {{ email: string, password: string, name?: string }} input
 * @returns {Promise<Account>}
 */
export async function signup({ email, password, name }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw Object.assign(new Error("Enter a valid email."), { code: "invalid_email" });
  }
  if (!password || password.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters."), { code: "weak_password" });
  }

  const users = readUsers();
  if (users[normalized]) {
    throw Object.assign(new Error("An account with that email already exists. Log in instead."), {
      code: "exists",
    });
  }

  const account = newFreeAccount({
    email: normalized,
    name,
    passwordHash: await hashPassword(password),
    provider: "password",
  });

  users[normalized] = account;
  writeUsers(users);
  setSession(normalized);
  return publicAccount(account);
}

/**
 * @param {{ email: string, password: string }} input
 * @returns {Promise<Account>}
 */
export async function login({ email, password }) {
  const normalized = String(email || "").trim().toLowerCase();
  const users = readUsers();
  const account = users[normalized];
  if (!account) {
    throw Object.assign(new Error("No account found for that email."), { code: "not_found" });
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
  setSession(normalized);
  return publicAccount(account);
}

/**
 * Create or resume an account from Google / Apple.
 * @param {{ provider: 'google' | 'apple', email: string, name?: string, providerUserId: string }} input
 */
export async function loginWithSocial({ provider, email, name, providerUserId }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw Object.assign(new Error("That provider didn’t return an email."), { code: "no_email" });
  }

  const users = readUsers();
  let account = users[normalized];

  if (!account) {
    account = newFreeAccount({
      email: normalized,
      name,
      passwordHash: null,
      provider,
      providerUserId: providerUserId || null,
    });
    users[normalized] = account;
    writeUsers(users);
  } else {
    account.provider = account.provider || provider;
    account.providerUserId = account.providerUserId || providerUserId || null;
    // Prefer a real provider name whenever we get one; replace email stubs
    if (name && !isStubName(name, normalized)) {
      account.name = String(name).trim();
    } else if (isStubName(account.name, normalized)) {
      account.name = displayNameFrom(normalized, name);
    }
    users[normalized] = account;
    writeUsers(users);
  }

  setSession(normalized);
  return publicAccount(account);
}

/** Persist mutable fields on the signed-in account. */
export function updateAccount(patch) {
  const session = getSession();
  if (!session) return null;
  const users = readUsers();
  const account = users[session.email];
  if (!account) return null;
  Object.assign(account, patch);
  users[session.email] = account;
  writeUsers(users);
  return publicAccount(account);
}
