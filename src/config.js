"use strict";

require("dotenv").config();

const path = require("path");

function required(name) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

// First non-empty of several env var names (so SEEDBOX_* is preferred but the
// older WHATBOX_* names still work for anyone migrating).
function firstOf(...names) {
  for (const n of names) {
    const v = required(n);
    if (v) return v;
  }
  return null;
}

const baseUrl = required("ADDON_BASE_URL") || "http://127.0.0.1:7700";
const secret = required("ADDON_SECRET");

const config = {
  // Where the index + caches are written. On hosts with a persistent disk
  // (e.g. Render), set DATA_DIR to the mounted path; otherwise local ./data.
  dataDir: required("DATA_DIR") || path.join(__dirname, "..", "data"),
  addon: {
    // Display name (manifest + admin title + stream source label).
    name: required("ADDON_NAME") || "Seedbox Library",
    // PORT is injected by the host (Render etc.); fall back to ADDON_PORT/7700.
    port: Number(process.env.PORT) || Number(process.env.ADDON_PORT) || 7700,
    baseUrl,
    // Secret path segment that gates access (so a public URL can't be guessed).
    secret,
    // Public base used to build manifest/relay URLs — includes the secret when set.
    publicUrl: secret ? `${baseUrl.replace(/\/+$/, "")}/${secret}` : baseUrl,
  },
  seedbox: {
    httpBaseUrl: firstOf("SEEDBOX_HTTP_BASE_URL", "WHATBOX_HTTP_BASE_URL"),
    httpUser: firstOf("SEEDBOX_HTTP_USER", "WHATBOX_HTTP_USER"),
    httpPass: firstOf("SEEDBOX_HTTP_PASS", "WHATBOX_HTTP_PASS"),
    libraryPath: firstOf("SEEDBOX_LIBRARY_PATH", "WHATBOX_LIBRARY_PATH"),
  },
  keys: {
    tmdb: required("TMDB_API_KEY"),
    tvdb: required("TVDB_API_KEY"),
    rpdb: required("RPDB_API_KEY"),
    mdblist: required("MDBLIST_API_KEY"),
    gemini: required("GEMINI_API_KEY"),
  },
};

module.exports = config;
