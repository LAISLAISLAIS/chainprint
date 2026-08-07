#!/usr/bin/env node
/**
 * Preflight checks before production deploy.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed += 1;
}

console.log("Chainprint release-check\n");

// .env.example keys
const envExample = readFileSync(join(root, ".env.example"), "utf8");
for (const key of [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SITE_URL",
  "CORS_ORIGINS",
  "SITE_PASSWORD",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "UPSTASH_REDIS_REST_URL",
]) {
  if (envExample.includes(key)) pass(`.env.example documents ${key}`);
  else fail(`.env.example missing ${key}`);
}

// Redirects
const redirects = readFileSync(join(root, "_redirects"), "utf8");
for (const path of [
  "/api/stripe/checkout",
  "/api/stripe/webhook",
  "/api/stripe/portal",
  "/api/stripe/session",
  "/api/health",
]) {
  if (redirects.includes(path)) pass(`_redirects has ${path}`);
  else fail(`_redirects missing ${path}`);
}

// Migrations
const migDir = join(root, "supabase/migrations");
for (const f of ["006_billing.sql", "007_consume_analysis.sql", "008_profiles_rls_lockdown.sql"]) {
  if (existsSync(join(migDir, f))) pass(`migration ${f}`);
  else fail(`missing migration ${f}`);
}

// No default gate password
const gate = readFileSync(join(root, "netlify/edge-functions/site-gate.js"), "utf8");
if (/chainmanpreet/.test(gate)) fail("site-gate still contains default password");
else pass("site-gate has no hardcoded default password");

// Publishable fallback only for non-production (must still fail closed in prod)
const supabaseShared = readFileSync(join(root, "netlify/functions/_shared/supabase.mjs"), "utf8");
if (!/isProductionRuntime/.test(supabaseShared)) {
  fail("functions supabase helper missing production fail-closed guard");
} else pass("functions supabase helper fails closed in production");
if (!/DEV_PUBLISHABLE/.test(supabaseShared)) {
  fail("expected named DEV_PUBLISHABLE fallback for local only");
} else pass("local publishable fallback is explicitly named");

// DEV_UNLOCK default off
const quota = readFileSync(join(root, "js/auth/quota.js"), "utf8");
if (/export const DEV_UNLOCK_PRO = true/.test(quota)) {
  fail("DEV_UNLOCK_PRO hardcoded true");
} else pass("DEV_UNLOCK_PRO not hardcoded true");

// Stripe functions present
const fnDir = join(root, "netlify/functions");
for (const f of [
  "stripe-checkout.mjs",
  "stripe-webhook.mjs",
  "stripe-portal.mjs",
  "stripe-session.mjs",
  "health.mjs",
]) {
  if (existsSync(join(fnDir, f))) pass(`function ${f}`);
  else fail(`missing function ${f}`);
}

// package.json stripe dep
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.dependencies?.stripe) pass("package.json depends on stripe");
else fail("package.json missing stripe");

console.log("");
if (failed) {
  console.error(`release-check failed (${failed} issue(s))`);
  process.exit(1);
}
console.log("release-check passed");
