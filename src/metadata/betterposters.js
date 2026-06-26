"use strict";

// BetterPosters (btttr.cc) — high-quality posters with rating/quality/genre/age
// badges baked in, keyed by IMDb id. Keyless, no API key required. Applied at
// serve time alongside RPDB/TMDB.
//
// We use the "poster-qa" key (badges on) and allow two live-editable options:
//   - rating source (rs): IM/TM/RT/MC/TR; Average is the default (no rs param)
//   - poster language (lang): English is the default (no lang param)
//
// btttr.cc returns 404 (no fallback image) for ids it doesn't have, so the
// scanner verifies availability and records it; serve-time then falls back to
// RPDB/TMDB when a poster is missing. Verification results are cached to
// data/betterposters-cache.json so re-scans don't re-check.

const fs = require("fs");
const path = require("path");
const config = require("../config");
const settings = require("../settings");

const BASE = "https://btttr.cc";

// Canonical (option-free) poster URL — used for the availability check, since
// whether btttr.cc has a poster doesn't depend on the rating source/language.
function canonicalUrl(imdbId) {
  return `${BASE}/poster-qa/imdb/poster-default/${imdbId}.jpg`;
}
const CACHE_FILE = path.join(config.dataDir, "betterposters-cache.json");

let cache = null;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}

// imdbId like "tt1234567". Returns the serve URL (with the configured rating
// source + language applied) or null for an invalid id.
function posterUrl(imdbId) {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
  const params = [];
  const rs = settings.get("posterRatingSource");
  if (rs && rs !== "AV") params.push(`rs=${encodeURIComponent(rs)}`); // Average = default (no rs)
  const lang = settings.get("posterLang");
  if (lang && lang !== "en") params.push(`lang=${encodeURIComponent(lang)}`); // English = default
  const qs = params.length ? `?${params.join("&")}` : "";
  return `${canonicalUrl(imdbId)}${qs}`;
}

// Check (and cache) whether btttr.cc actually has a poster for this id. Used by
// the scanner. On network error, returns false (so RPDB/TMDB take over) without
// caching, so a transient failure is retried on the next scan.
async function available(imdbId) {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return false;
  const url = canonicalUrl(imdbId);
  if (!cache) cache = loadCache();
  if (Object.prototype.hasOwnProperty.call(cache, imdbId)) return cache[imdbId];

  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    const ok = res.ok && (res.headers.get("content-type") || "").startsWith("image/");
    cache[imdbId] = ok;
    saveCache();
    return ok;
  } catch {
    return false; // transient — don't cache
  }
}

module.exports = { posterUrl, available };
