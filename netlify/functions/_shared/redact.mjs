const SENSITIVE =
  /^(password|passwd|token|authorization|api[_-]?key|secret|refresh[_-]?token|cookie|stripe[_-]?secret|service[_-]?role)/i;

export function redact(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (typeof value === "string") {
    if (value.length > 500) return `${value.slice(0, 120)}…[truncated]`;
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 5) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
