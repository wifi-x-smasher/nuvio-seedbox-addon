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
    return json(res, { ok: true, settings: settings.update(body) });
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
    const key = String(body.key || "").trim();
    const tmdbId = Number(body.tmdbId);
    if (!key || !Number.isFinite(tmdbId) || tmdbId <= 0) {
      return json(res, { error: "key and a valid tmdbId are required" }, 400);
    }
    overrides.set(type, key, tmdbId);
    // Drop any cached (wrong/empty) match for this key so the override applies.
    try {
      const cf = path.join(config.dataDir, "match-cache.json");
      const c = JSON.parse(fs.readFileSync(cf, "utf8"));
      const bucket = type === "movie" ? "movies" : "series";
      if (c[bucket]) delete c[bucket][key];
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
