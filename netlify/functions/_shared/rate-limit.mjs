/**
 * Fixed-window rate limit.
 * - Local / unset Upstash: in-memory (per isolate)
 * - Production with Upstash: shared Redis
 * - Production without Upstash: fail closed on requireShared=true routes
 */

import { Redis } from "@upstash/redis";

const memory = new Map();

function clientIp(event) {
  const xf = event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "";
  const first = String(xf).split(",")[0].trim();
  return first || event.headers?.["client-ip"] || event.headers?.["x-nf-client-connection-ip"] || "unknown";
}

function upstashConfigured() {
  return Boolean(
    String(process.env.UPSTASH_REDIS_REST_URL || "").trim() &&
      String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim()
  );
}

function isProduction() {
  return process.env.CONTEXT === "production" || process.env.NODE_ENV === "production";
}

let redis = null;
function getRedis() {
  if (!upstashConfigured()) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

async function memoryAllow(key, limit, windowSec) {
  const now = Date.now();
  const bucket = memory.get(key);
  if (!bucket || now >= bucket.resetAt) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, remaining: limit - 1, retryAfter: windowSec };
  }
  bucket.count += 1;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, retryAfter };
  }
  return { ok: true, remaining: Math.max(0, limit - bucket.count), retryAfter };
}

async function redisAllow(key, limit, windowSec) {
  const r = getRedis();
  if (!r) return null;
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, windowSec);
  }
  const ttl = await r.ttl(key);
  const retryAfter = ttl > 0 ? ttl : windowSec;
  if (count > limit) {
    return { ok: false, remaining: 0, retryAfter };
  }
  return { ok: true, remaining: Math.max(0, limit - count), retryAfter };
}

/**
 * @param {object} event
 * @param {{ bucket: string, limit: number, windowSec?: number, userId?: string, requireShared?: boolean }} opts
 */
export async function rateLimit(event, opts) {
  const windowSec = opts.windowSec ?? 60;
  const limit = opts.limit;
  const ip = clientIp(event);
  const keys = [`rl:${opts.bucket}:ip:${ip}`];
  if (opts.userId) keys.push(`rl:${opts.bucket}:user:${opts.userId}`);

  const requireShared = opts.requireShared ?? false;

  if (!upstashConfigured()) {
    if (isProduction() && requireShared) {
      return {
        ok: false,
        statusCode: 503,
        error: "Rate limiting is not configured.",
        retryAfter: 60,
      };
    }
    for (const key of keys) {
      const result = await memoryAllow(key, limit, windowSec);
      if (!result.ok) {
        return { ok: false, statusCode: 429, error: "Too many requests. Try again shortly.", ...result };
      }
    }
    return { ok: true };
  }

  try {
    for (const key of keys) {
      const result = await redisAllow(key, limit, windowSec);
      if (!result) {
        throw new Error("redis unavailable");
      }
      if (!result.ok) {
        return { ok: false, statusCode: 429, error: "Too many requests. Try again shortly.", ...result };
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("[rate-limit] backend error", err?.message || err);
    if (requireShared || isProduction()) {
      return {
        ok: false,
        statusCode: 503,
        error: "Rate limiting temporarily unavailable.",
        retryAfter: 30,
      };
    }
    // Dev: fall back to memory
    for (const key of keys) {
      const result = await memoryAllow(key, limit, windowSec);
      if (!result.ok) {
        return { ok: false, statusCode: 429, error: "Too many requests. Try again shortly.", ...result };
      }
    }
    return { ok: true };
  }
}

export function rateLimitHeaders(result) {
  if (!result || result.ok) return {};
  const h = {};
  if (result.retryAfter) h["Retry-After"] = String(result.retryAfter);
  return h;
}

export function rateLimitBackendStatus() {
  if (upstashConfigured()) return "upstash";
  if (isProduction()) return "missing";
  return "memory";
}
