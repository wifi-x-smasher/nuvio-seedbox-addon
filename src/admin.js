"use strict";

// Admin panel (MVP): dashboard, rescan, and an "unmatched fixer" that pins a
// TMDB id from the UI. Gated by ADMIN_PASSWORD (HTTP Basic) — separate from the
// manifest secret, so a shared manifest URL can't open admin. Mounted by
// index.js under the secret path (it sees inner paths /admin and /api/*).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const store = require("./store");
const overrides = require("./overrides");
const settings = require("./settings");
const progress = require("./progress");
const logger = require("./logger");
const renderPage = require("./admin-page");
const seedbox = require("./seedbox/client");
const tmdb = require("./metadata/tmdb");

const CONN_KEYS = ["seedboxBaseUrl", "seedboxUser", "seedboxPass"];

function matches(url) {
  const p = url.split("?")[0];
  return p === "/admin" || p === "/admin/" || p.startsWith("/api/");
}

// Constant-time string compare so the admin password can't be guessed by
// timing the response. (Differing lengths short-circuit, which is fine.)
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function authed(req) {
  const pw = settings.get("adminPassword");
  if (!pw) return false; // admin disabled until a password is set
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
  return safeEqual(decoded.slice(decoded.indexOf(":") + 1), pw);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, obj, code = 200) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function buildStatus() {
  const idx = store.loadIndex();
  const movies = idx.movies || [];
  const series = idx.series || [];
  const episodes = series.reduce((n, s) => n + (s.episodes ? s.episodes.length : 0), 0);
  const byLang = {};
  for (const s of series) {
    const l = s.lang || "other";
    byLang[l] = (byLang[l] || 0) + 1;
  }
  const raw = [
    ...movies.filter((m) => !m.matched).map((m) => ({ type: "movie", name: m.name, key: m.file || "" })),
    ...series
      .filter((s) => !s.matched)
      .map((s) => ({ type: "series", name: s.name, key: (s.folders && s.folders[0]) || "" })),
  ];

  // Sidecar subtitle coverage.
  let subFiles = 0;
  let subbedItems = 0; // movies + episodes with at least one sidecar sub
  for (const m of movies) {
    if (m.subs && m.subs.length) { subbedItems++; subFiles += m.subs.length; }
  }
  for (const s of series) {
    for (const e of s.episodes || []) {
      if (e.subs && e.subs.length) { subbedItems++; subFiles += e.subs.length; }
    }
  }

  const orphans = idx.orphanSubs || [];
  const skipped = idx.skippedFolders || [];

  return {
    name: settings.get("addonName"),
    movies: movies.length,
    series: series.length,
    episodes,
    matched: movies.filter((m) => m.matched).length + series.filter((s) => s.matched).length,
    rawCount: raw.length,
    subFiles,
    subbedItems,
    unpickedSubs: orphans.length,
    unpickedList: orphans.slice(0, 50).map((o) => o.name),
    skippedCount: skipped.length,
    skippedList: skipped.slice(0, 50).map((f) => `${f.name} (${f.reason})`),
    byLang,
    lastScan: idx.updatedAt || null,
    raw,
    manifestUrl: `${settings.publicUrl()}/manifest.json`,
  };
}

function tailLog(lines = 200) {
  return logger.tail(lines);
}

// "wbx:movie:t550" -> 550; unmatched ids ("...:f<hash>") have no TMDB id.
function tmdbIdOf(id) {
  const m = String(id || "").match(/^wbx:(?:movie|series):t(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Search the whole library (matched AND unmatched) so a wrong match can be
// corrected, not just a missing one. `keys` are the override keys: the movie
// filename, or EVERY source folder of a series — a split-season show is matched
// per folder, so pinning only the first would leave the others on the old id.
function searchLibrary(q, limit = 40) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return [];
  const idx = store.loadIndex();
  const out = [];
  for (const m of idx.movies || []) {
    if (out.length >= limit) break;
    if (!(m.name || "").toLowerCase().includes(query)) continue;
    out.push({
      type: "movie",
      name: m.name,
      year: m.year || null,
      tmdbId: tmdbIdOf(m.id),
      matched: Boolean(m.matched),
      poster: m.poster || null,
      keys: m.file ? [m.file] : [],
    });
  }
  for (const s of idx.series || []) {
    if (out.length >= limit) break;
    if (!(s.name || "").toLowerCase().includes(query)) continue;
    out.push({
      type: "series",
      name: s.name,
      year: s.year || null,
      tmdbId: tmdbIdOf(s.id),
      matched: Boolean(s.matched),
      poster: s.poster || null,
      keys: Array.isArray(s.folders) ? s.folders.slice() : [],
    });
  }
  return out;
}

// ctx: { runScan(), scanning(): bool }
async function handle(req, res, ctx) {
  if (!authed(req)) {
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", 'Basic realm="Seedbox addon admin"');
    res.end(settings.get("adminPassword") ? "Authentication required" : "Admin disabled (no admin password set)");
    return;
  }

  const url = req.url.split("?")[0];

  if (url === "/admin" || url === "/admin/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderPage());
    return;
  }

  if (url === "/api/status" && req.method === "GET") {
    return json(res, { ...buildStatus(), scanning: ctx.scanning(), progress: progress.read() });
  }

  if (url === "/api/log" && req.method === "GET") {
    return json(res, { log: tailLog() });
  }

  if (url === "/api/settings" && req.method === "GET") {
    return json(res, settings.masked());
  }

  if (url === "/api/settings" && req.method === "POST") {
    const body = await readBody(req);
    const updated = settings.update(body);
    // If the save touched seedbox connection fields, verify them now (with the
    // just-saved values) so bad creds are caught here, not at stream time.
    let connection = null;
    if (CONN_KEYS.some((k) => k in body)) connection = await seedbox.testConnection();
    return json(res, { ok: true, settings: updated, connection });
  }

  if (url === "/api/test-connection" && req.method === "POST") {
    return json(res, await seedbox.testConnection());
  }

  // Find a title in the library (matched or not) so its TMDB id can be fixed.
  if (url === "/api/library/search" && req.method === "GET") {
    const q = new URLSearchParams(req.url.split("?")[1] || "").get("q") || "";
    return json(res, { items: searchLibrary(q) });
  }

  // Look up candidates on TMDB so the correct id can be picked without leaving
  // the panel (uses the configured TMDB key).
  if (url === "/api/tmdb/search" && req.method === "GET") {
    const p = new URLSearchParams(req.url.split("?")[1] || "");
    const q = (p.get("q") || "").trim();
    const isMovie = p.get("type") === "movie";
    if (!q) return json(res, { results: [] });
    try {
      const raw = isMovie ? await tmdb.searchMovieAll(q) : await tmdb.searchTvAll(q);
      const results = (raw || []).slice(0, 8).map((c) => ({
        tmdbId: c.id,
        name: c.title || c.name,
        year: ((c.release_date || c.first_air_date) || "").slice(0, 4) || null,
        poster: c.poster_path ? tmdb.img(c.poster_path, "w185") : null,
      }));
      return json(res, { results });
    } catch (err) {
      return json(res, { error: `TMDB search failed: ${err.message}` }, 502);
    }
  }

  // Download a full backup: settings (incl. secrets — admin-gated), manual
  // overrides, and the built index (so restore avoids a re-scan).
  if (url === "/api/backup" && req.method === "GET") {
    const backup = {
      kind: "nuvio-seedbox-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: readJson(path.join(config.dataDir, "settings.json")) || {},
      overrides: overrides.load(),
      index: readJson(path.join(config.dataDir, "index.json")) || {},
    };
    const stamp = backup.exportedAt.slice(0, 10);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="nuvio-seedbox-backup-${stamp}.json"`);
    res.end(JSON.stringify(backup, null, 2));
    return;
  }

  // Restore from a backup file. Each section is optional; only what's present is
  // written. Everything is read live, so no restart is needed.
  if (url === "/api/restore" && req.method === "POST") {
    const body = await readBody(req);
    if (!body || (body.kind && !String(body.kind).includes("backup"))) {
      return json(res, { error: "That doesn't look like a backup file." }, 400);
    }
    const restored = [];
    if (body.settings && typeof body.settings === "object") {
      const f = path.join(config.dataDir, "settings.json");
      writeJsonAtomic(f, body.settings);
      try { fs.chmodSync(f, 0o600); } catch { /* best-effort */ }
      restored.push("settings");
    }
    if (body.overrides && typeof body.overrides === "object") {
      overrides.replace(body.overrides);
      restored.push("overrides");
    }
    if (body.index && typeof body.index === "object") {
      writeJsonAtomic(path.join(config.dataDir, "index.json"), body.index);
      restored.push("index");
    }
    return json(res, { ok: true, restored });
  }

  // --- Library gaps (missing episodes) ---
  if (url === "/api/gaps" && req.method === "GET") {
    const report = readJson(path.join(config.dataDir, "gaps.json"));
    return json(res, {
      running: ctx.gapsRunning ? ctx.gapsRunning() : false,
      report: report || null,
    });
  }
  if (url === "/api/gaps/refresh" && req.method === "POST") {
    if (ctx.runGapReport) ctx.runGapReport();
    return json(res, { started: true });
  }

  if (url === "/api/rescan" && req.method === "POST") {
    const body = await readBody(req);
    if (body.mode === "full") {
      try {
        fs.unlinkSync(path.join(config.dataDir, "match-cache.json"));
      } catch {
        /* nothing to clear */
      }
    }
    ctx.runScan();
    return json(res, { started: true, mode: body.mode === "full" ? "full" : "quick" });
  }

  if (url === "/api/override" && req.method === "POST") {
    const body = await readBody(req);
    const type = body.type === "movie" ? "movie" : "series";
    // `keys` (all source folders of a series) is preferred; `key` stays
    // supported for the original single-key pin flow.
    const keys = (Array.isArray(body.keys) ? body.keys : [body.key])
      .map((k) => String(k || "").trim())
      .filter(Boolean);
    const tmdbId = Number(body.tmdbId);
    if (!keys.length || !Number.isFinite(tmdbId) || tmdbId <= 0) {
      return json(res, { error: "key and a valid tmdbId are required" }, 400);
    }
    for (const k of keys) overrides.set(type, k, tmdbId);
    // Drop any cached (wrong/empty) match for these keys so the override applies.
    try {
      const cf = path.join(config.dataDir, "match-cache.json");
      const c = JSON.parse(fs.readFileSync(cf, "utf8"));
      const bucket = type === "movie" ? "movies" : "series";
      if (c[bucket]) for (const k of keys) delete c[bucket][k];
      fs.writeFileSync(cf, JSON.stringify(c, null, 2), "utf8");
    } catch {
      /* no cache yet */
    }
    ctx.runScan();
    return json(res, { ok: true, rescanning: true });
  }

  res.statusCode = 404;
  res.end("Not found");
}

module.exports = { matches, handle };
