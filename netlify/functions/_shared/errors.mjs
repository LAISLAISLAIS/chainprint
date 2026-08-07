/**
 * Safe JSON error responses — log detail server-side, never leak internals.
 */

import { redact } from "./redact.mjs";

export function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function jsonError(statusCode, publicMessage, err, extraHeaders = {}) {
  if (err) {
    console.error("[chainprint]", publicMessage, redact(err));
  }
  return jsonResponse(statusCode, { error: publicMessage }, extraHeaders);
}
