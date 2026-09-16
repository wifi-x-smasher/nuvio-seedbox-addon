"use strict";

// Turn a failed fetch() into a message a person can act on.
//
// Node's fetch rejects with the generic message "fetch failed" for everything
// that happens before an HTTP response: a failed DNS lookup, a refused or
// timed-out connection, an HTTPS certificate problem. The real reason sits on
// err.cause (with Node 20's IPv4/IPv6 fallback it can be an AggregateError
// holding one error per address tried). Printing err.message alone hides it.

const CERT_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const REASONS = {
  ENOTFOUND: "hostname not found (DNS lookup failed)",
  EAI_AGAIN: "hostname lookup failed (DNS temporarily unavailable)",
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection was reset",
  ETIMEDOUT: "connection timed out",
  UND_ERR_CONNECT_TIMEOUT: "connection timed out",
  UND_ERR_SOCKET: "connection was closed unexpectedly",
  ENETUNREACH: "network unreachable",
  EHOSTUNREACH: "host unreachable",
};

// Codes where the add-on reached nothing at all. When the add-on runs on the
// same machine as the file server, this is usually that machine failing to
// reach its own public address.
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "TIMEOUT",
]);

// Find the most specific underlying error (walks .cause). Returns the error
// carrying the code, plus every address that was tried: with Node 20+'s IPv4 /
// IPv6 fallback the cause is an AggregateError with one error per address, and
// seeing "::1" vs "127.0.0.1" is what tells an IPv6 problem apart.
function rootCause(err) {
  let cur = err;
  for (let i = 0; i < 5 && cur; i++) {
    const inner = Array.isArray(cur.errors) ? cur.errors.filter((e) => e && e.code) : [];
    if (cur.code || inner.length) {
      const addrs = (inner.length ? inner : [cur])
        .filter((e) => e.address)
        .map((e) => `${e.address}${e.port ? `:${e.port}` : ""}`);
      return { error: cur.code ? cur : inner[0], addrs };
    }
    cur = cur.cause;
  }
  return null;
}

// Returns { code, reason, detail, unreachable }.
//   code        machine code ("ECONNREFUSED", "TIMEOUT", ...) or null
//   reason      short plain-English reason
//   detail      reason plus the raw code and address, for logs and support
//   unreachable true when nothing answered at all (see UNREACHABLE)
function describeFetchError(err, { timeoutMs } = {}) {
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    const secs = timeoutMs ? ` after ${Math.round(timeoutMs / 1000)}s` : "";
    const reason = `no response${secs} (timed out)`;
    return { code: "TIMEOUT", reason, detail: reason, unreachable: true };
  }

  const found = rootCause(err);
  if (!found) {
    // No code anywhere: surface the innermost message rather than "fetch failed".
    let cur = err;
    while (cur && cur.cause) cur = cur.cause;
    const msg = (cur && cur.message) || (err && err.message) || String(err);
    return { code: null, reason: msg, detail: msg, unreachable: false };
  }

  const cause = found.error;
  const code = cause.code;
  let reason = REASONS[code];
  if (!reason && CERT_CODES.has(code)) reason = "HTTPS certificate problem";
  if (!reason) reason = cause.message || code;

  const where = found.addrs.length ? ` ${found.addrs.join(", ")}` : "";
  const detail = reason === code ? `${code}${where}` : `${reason} (${code}${where})`;
  return { code, reason, detail, unreachable: UNREACHABLE.has(code) };
}

// Hint shown when nothing answered, for the common "add-on and files on the
// same seedbox" setup (Ultra.cc and similar shared hosts).
const SAME_MACHINE_HINT =
  "If the add-on runs on the same seedbox as your files, the seedbox may be unable " +
  "to reach its own public address. See Troubleshooting in the README.";

module.exports = { describeFetchError, SAME_MACHINE_HINT };
