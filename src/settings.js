"use strict";

// Runtime-editable settings. Values live in <dataDir>/settings.json (written by
// the admin panel) and override the .env defaults, so they can be changed from
// the UI without restarting. Consumers call settings.get(key) at use-time, so
// changes apply live. Secrets are stored here too (file is chmod 600).

const fs = require("fs");
const path = require("path");
const config = require("./config");

const FILE = path.join(config.dataDir, "settings.json");

// Keys the admin panel can edit, and where each falls back to in .env.
const EDITABLE = [
  "posterSource", "geminiModel", "scanIntervalMinutes",
  "tmdbKey", "geminiKey", "rpdbKey",
  "seedboxBaseUrl", "seedboxUser", "seedboxPass",
  "movieDirs", "seriesDirs", // comma-separated folder names under the base URL
];
const SECRETS = new Set(["tmdbKey", "geminiKey", "rpdbKey", "seedboxPass"]);

function envFallback(key) {
  switch (key) {
    case "posterSource": return (process.env.POSTER_SOURCE || "better").toLowerCase();
    case "geminiModel": return process.env.GEMINI_MODEL || "gemini-flash-latest";
    case "scanIntervalMinutes":
      return Number(process.env.SCAN_INTERVAL_MINUTES) ||
        (Number(process.env.SCAN_INTERVAL_HOURS) || 12) * 60;
    case "tmdbKey": return config.keys.tmdb;
    case "geminiKey": return config.keys.gemini;
    case "rpdbKey": return config.keys.rpdb;
    case "seedboxBaseUrl": return config.seedbox.httpBaseUrl;
    case "seedboxUser": return config.seedbox.httpUser;
    case "seedboxPass": return config.seedbox.httpPass;
    case "movieDirs": return process.env.MOVIE_DIRS || "Movies";
    case "seriesDirs": return process.env.SERIES_DIRS || "TV Shows";
    default: return null;
  }
}

let cache = {};
let cacheMtime = -1;
function readFile() {
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs !== cacheMtime) {
      cache = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
      cacheMtime = st.mtimeMs;
    }
  } catch {
    cache = {};
    cacheMtime = -1;
  }
  return cache;
}

// Current effective value: settings.json override if present, else .env default.
function get(key) {
  const f = readFile();
  const v = f[key];
  return v !== undefined && v !== null && v !== "" ? v : envFallback(key);
}

// Apply a partial update. Secrets are skipped when blank (so "leave unchanged"
// works in the UI). Returns the new masked view.
function update(partial) {
  let cur;
  try {
    cur = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
  } catch {
    cur = {};
  }
  for (const k of EDITABLE) {
    if (!(k in partial)) continue;
    let v = partial[k];
    if (typeof v === "string") v = v.trim();
    if (SECRETS.has(k) && (v === "" || v == null)) continue; // keep current secret
    if (k === "scanIntervalMinutes") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) continue;
      v = n;
    }
    cur[k] = v;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cur, null, 2), "utf8");
  try { fs.chmodSync(FILE, 0o600); } catch { /* best-effort */ }
  cacheMtime = -1;
  return masked();
}

// Masked view for the UI: secrets shown as "set"/empty, others as their value.
function masked() {
  const out = {};
  for (const k of EDITABLE) {
    const v = get(k);
    out[k] = SECRETS.has(k) ? (v ? "set" : "") : (v == null ? "" : v);
  }
  return out;
}

module.exports = { get, update, masked, EDITABLE, SECRETS };
