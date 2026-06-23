"use strict";

// Seedbox access via an HTTP auto-index (Apache/nginx "Index of ..." listing)
// with HTTP Basic auth. We read directory listings over HTTPS and build direct
// file URLs. This needs only the base URL + credentials (no knowledge of the
// box's local filesystem path), and the hrefs give us the exact playable URLs.
//
// Range requests (seeking) are handled by the file server directly; the player
// fetches the file URL with the Authorization header we attach to streams.

const settings = require("../settings");

function authHeaderValue() {
  const httpUser = settings.get("seedboxUser");
  const httpPass = settings.get("seedboxPass");
  if (!httpUser) return null;
  const token = Buffer.from(`${httpUser}:${httpPass || ""}`).toString("base64");
  return `Basic ${token}`;
}

// Encode a human path like "TV Shows/" into URL form ("TV%20Shows/"),
// preserving the slash separators.
function encodePath(humanPath) {
  return humanPath
    .split("/")
    .map((segment) => (segment ? encodeURIComponent(segment) : segment))
    .join("/");
}

function baseUrl() {
  const base = settings.get("seedboxBaseUrl");
  if (!base) throw new Error("Seedbox base URL is not set");
  return base.endsWith("/") ? base : `${base}/`;
}

// encodedRelPath is already URL-encoded and relative to the base (e.g.
// "Movies/" or "TV%20Shows/Some.Release/").
function fileUrl(encodedRelPath) {
  return baseUrl() + encodedRelPath.replace(/^\/+/, "");
}

function authHeaders() {
  const auth = authHeaderValue();
  return auth ? { Authorization: auth } : {};
}

// Pull child entries out of an auto-index HTML page.
function parseIndexHtml(html) {
  const entries = [];
  const seen = new Set();
  const hrefRegex = /<a\s+[^>]*href="([^"]+)"/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href) continue;
    // Skip sort headers (?C=N;O=A), absolute/parent links, schemes.
    if (href.startsWith("?")) continue;
    if (href.startsWith("/")) continue;
    if (href.startsWith("../") || href === "..") continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // http:, mailto:, etc.
    if (seen.has(href)) continue;
    seen.add(href);

    const isDir = href.endsWith("/");
    const name = decodeURIComponent(href.replace(/\/+$/, ""));
    if (!name) continue;
    entries.push({ name, isDir, href });
  }
  return entries;
}

// List a directory. encodedRelPath like "Movies/" or "TV%20Shows/Foo/".
// Returns [{ name, isDir, path }] where path is the encoded path relative to base.
async function listDir(encodedRelPath) {
  const rel = encodedRelPath.replace(/^\/+/, "");
  const url = fileUrl(rel);
  const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(20000) });
  if (res.status === 401) {
    throw new Error(`Auth failed (401) for ${url}. Check SEEDBOX_HTTP_USER/PASS.`);
  }
  if (!res.ok) {
    throw new Error(`Failed to list ${url}: HTTP ${res.status}`);
  }
  const html = await res.text();
  return parseIndexHtml(html).map((entry) => ({
    name: entry.name,
    isDir: entry.isDir,
    path: rel + entry.href,
  }));
}

module.exports = {
  authHeaderValue,
  authHeaders,
  encodePath,
  baseUrl,
  fileUrl,
  listDir,
  parseIndexHtml,
};
