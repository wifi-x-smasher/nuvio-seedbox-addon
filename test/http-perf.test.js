"use strict";

// TV performance work: cache lifetimes, gzip, keep-alive. These boot the real
// server so they check what a player actually receives, not what we intended.
//
// Why it matters: the server answers in ~20ms but a round trip from a TV is
// ~260ms, and without Cache-Control a player repeats that on every navigation.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const test = require("node:test");
const assert = require("node:assert/strict");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "wbx-perf-"));
const PORT = 7796;
const SECRET = "perftestsecret";
const BASE = `http://127.0.0.1:${PORT}/${SECRET}`;

// A library big enough that JSON responses cross the gzip threshold.
const episodes = Array.from({ length: 40 }, (_, i) => ({
  season: 1,
  episode: i + 1,
  streamPath: `TV%20Shows/Show/Show.S01E${String(i + 1).padStart(2, "0")}.1080p.WEB-DL.mkv`,
  container: "mkv",
  quality: "1080p",
  subs: [],
}));
const series = Array.from({ length: 30 }, (_, i) => ({
  id: `wbx:series:t${1000 + i}`,
  type: "series",
  name: `Test Show Number ${i} With A Reasonably Long Title`,
  year: "2024",
  lang: "ko",
  imdbId: `tt${2000000 + i}`,
  matched: true,
  poster: `https://image.tmdb.org/t/p/w500/poster${i}.jpg`,
  description: "A description long enough to make the payload realistic. ".repeat(4),
  episodes: i === 0 ? episodes : episodes.slice(0, 8),
}));
fs.writeFileSync(
  path.join(DATA, "index.json"),
  JSON.stringify({ movies: [], series, orphanSubs: [], skippedFolders: [], updatedAt: null }),
);
// Onboarding steers every request to /setup until the add-on is configured, so
// write the settings a finished setup would have produced.
fs.writeFileSync(
  path.join(DATA, "settings.json"),
  JSON.stringify({
    addonSecret: SECRET,
    seedboxBaseUrl: "https://box.example.com/private/",
    seedboxUser: "u",
    seedboxPass: "p",
    addonName: "Seedbox Library",
    addonBaseUrl: `http://127.0.0.1:${PORT}`,
    adminPassword: "pw",
    tmdbKey: "", // keep enrichment offline: no detail-page network calls
  }),
);

let child;
test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: {
      ...process.env,
      DATA_DIR: DATA,
      ADDON_PORT: String(PORT),
      ADDON_SECRET: SECRET,
      ADDON_BASE_URL: `http://127.0.0.1:${PORT}`,
      ADMIN_PASSWORD: "pw",
      SEEDBOX_HTTP_BASE_URL: "https://box.example.com/private/",
      SEEDBOX_HTTP_USER: "u",
      SEEDBOX_HTTP_PASS: "p",
      SEEDBOX_LIBRARY_PATH: "",
      TMDB_API_KEY: "", // keep enrichment offline: no detail-page network calls
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});

test.after(() => {
  if (child) child.kill();
});

const cacheOf = (res) => String(res.headers.get("cache-control") || "");

test("catalog answers may be reused, so a TV redraws rows without a round trip", async () => {
  const res = await fetch(`${BASE}/catalog/series/wbx-series-ko.json`);
  assert.equal(res.status, 200);
  const cc = cacheOf(res);
  assert.match(cc, /max-age=\d+/, `no Cache-Control: "${cc}"`);
  assert.match(cc, /public/);
  assert.match(cc, /stale-while-revalidate=\d+/, "stale answer should show instantly while refreshing");
  assert.equal((await res.json()).metas.length, 30);
});

test("detail pages are cached longer than rows (most expensive, most reopened)", async () => {
  const meta = await fetch(`${BASE}/meta/series/wbx:series:t1000.json`);
  const catalog = await fetch(`${BASE}/catalog/series/wbx-series-ko.json`);
  const age = (r) => Number((cacheOf(r).match(/max-age=(\d+)/) || [])[1]);
  assert.ok(age(meta) > 0 && age(catalog) > 0);
  assert.ok(age(meta) > age(catalog), `meta ${age(meta)}s should exceed catalog ${age(catalog)}s`);
});

test("stream answers are cached, but for less time than detail pages", async () => {
  const res = await fetch(`${BASE}/stream/series/wbx:series:t1000:1:1.json`);
  const age = Number((cacheOf(res).match(/max-age=(\d+)/) || [])[1]);
  assert.ok(age > 0, "streams should be cacheable");
  assert.ok(age <= 60 * 60, "a stale stream URL fails playback, so keep it short");
});

test("the manifest is cacheable but refreshes soon after a scan adds a row", async () => {
  const res = await fetch(`${BASE}/manifest.json`);
  const age = Number((cacheOf(res).match(/max-age=(\d+)/) || [])[1]);
  assert.ok(age > 0 && age <= 60 * 60);
});

test("text responses are gzipped for clients that ask", async () => {
  const plain = await fetch(`${BASE}/meta/series/wbx:series:t1000.json`, {
    headers: { "accept-encoding": "identity" },
  });
  const raw = Buffer.from(await plain.arrayBuffer());

  // undici decompresses transparently, so check the header and the wire size.
  const res = await fetch(`${BASE}/meta/series/wbx:series:t1000.json`, {
    headers: { "accept-encoding": "gzip" },
  });
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.match(String(res.headers.get("vary") || ""), /accept-encoding/i);
  const wire = Number(res.headers.get("content-length"));
  assert.ok(wire < raw.length, `gzip ${wire}B should beat plain ${raw.length}B`);
  assert.deepEqual((await res.json()).meta.id, "wbx:series:t1000", "body still intact");
});

test("clients that do not want gzip still get plain, correct JSON", async () => {
  const res = await fetch(`${BASE}/catalog/series/wbx-series-ko.json`, {
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(res.headers.get("content-encoding"), null);
  assert.equal((await res.json()).metas.length, 30);
});

test("tiny responses are not gzipped (the header would cost more than it saves)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, { headers: { "accept-encoding": "gzip" } });
  assert.equal(res.headers.get("content-encoding"), null);
  assert.equal(await res.text(), "ok");
});

test("the connection is held open for a browsing session", async () => {
  const res = await fetch(`${BASE}/manifest.json`, { headers: { connection: "keep-alive" } });
  assert.notEqual(String(res.headers.get("connection") || "").toLowerCase(), "close");
  const timeout = String(res.headers.get("keep-alive") || "");
  if (timeout) assert.match(timeout, /timeout=(\d+)/);
});
