"use strict";

// IMDb bridging: the add-on answers stream/subtitle requests for "tt" ids so the
// library shows up on any title's page. Env must be set BEFORE requiring config
// (it snapshots DATA_DIR at load); node --test runs each file in its own process.

const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wbx-bridge-"));
process.env.DATA_DIR = DATA_DIR;
process.env.SEEDBOX_HTTP_BASE_URL = "https://box.example.com/private/";
process.env.SEEDBOX_HTTP_USER = "u";
process.env.SEEDBOX_HTTP_PASS = "p";

fs.writeFileSync(
  path.join(DATA_DIR, "index.json"),
  JSON.stringify({
    movies: [
      { id: "wbx:movie:t550", type: "movie", name: "Fight Club", imdbId: "tt0137523",
        matched: true, streamPath: "Movies/Fight.Club.1080p.mkv", container: "mkv",
        quality: "1080p", subs: [{ path: "Movies/Fight.Club.en.srt", lang: "en", format: "srt" }] },
      // Two index records sharing an IMDb id (distinct TMDB entries for the same
      // film). NOTE: the scanner de-dupes by item id, so two files matching the
      // SAME tmdbId collapse to one record — see the duplicate-drop test below.
      { id: "wbx:movie:t551", type: "movie", name: "Fight Club 4K", imdbId: "tt0137523",
        matched: true, streamPath: "Movies/Fight.Club.2160p.mkv", container: "mkv",
        quality: "2160p", subs: [] },
      { id: "wbx:movie:f0abc", type: "movie", name: "No Imdb", matched: false,
        streamPath: "Movies/x.mkv", container: "mkv", subs: [] },
    ],
    series: [
      { id: "wbx:series:t1396", type: "series", name: "Breaking Bad", imdbId: "tt0903747",
        matched: true, episodes: [
          { season: 1, episode: 1, streamPath: "TV/BB.S01E01.mkv", container: "mkv", quality: "1080p", subs: [] },
          { season: 2, episode: 5, streamPath: "TV/BB.S02E05.mkv", container: "mkv", quality: "720p", subs: [] },
        ] },
    ],
    orphanSubs: [], skippedFolders: [], updatedAt: null,
  }),
  "utf8",
);

const test = require("node:test");
const assert = require("node:assert/strict");
const store = require("../src/store");
const manifest = require("../src/manifest");

// --- manifest shape --------------------------------------------------------
function resourceNamed(name) {
  return manifest.build().resources.find((r) => r && r.name === name);
}

test("meta NEVER claims the tt prefix (Cinemeta must keep detail pages)", () => {
  const meta = resourceNamed("meta");
  assert.ok(meta, "meta should be a full resource object");
  assert.ok(!meta.idPrefixes.includes("tt"), "meta must not claim tt");
  assert.ok(meta.idPrefixes.includes("wbx:"));
});

test("stream and subtitles claim tt, and agree with each other", () => {
  const stream = resourceNamed("stream");
  const subs = resourceNamed("subtitles");
  assert.ok(stream.idPrefixes.includes("wbx:"));
  assert.ok(stream.idPrefixes.includes("tt"), "stream should claim tt when bridging is on");
  assert.deepEqual(stream.idPrefixes, subs.idPrefixes);
});

test("catalog is still advertised", () => {
  assert.ok(manifest.build().resources.includes("catalog"));
});

// --- resolution ------------------------------------------------------------
test("movie by IMDb id returns every held copy", async () => {
  const streams = await store.getStreams("movie", "tt0137523");
  assert.equal(streams.length, 2);
  const titles = streams.map((s) => s.title).sort();
  assert.deepEqual(titles, ["1080p mkv", "2160p mkv"]);
  assert.ok(streams[0].url.startsWith("https://box.example.com/private/"));
});

test("episode by IMDb id maps season/episode correctly", async () => {
  const s1 = await store.getStreams("series", "tt0903747:1:1");
  assert.equal(s1.length, 1);
  assert.match(s1[0].title, /^S1E1 /);
  assert.ok(s1[0].url.endsWith("TV/BB.S01E01.mkv"));

  const s2 = await store.getStreams("series", "tt0903747:2:5");
  assert.ok(s2[0].url.endsWith("TV/BB.S02E05.mkv"));
});

test("unknown or absent IMDb id yields no streams", async () => {
  assert.deepEqual(await store.getStreams("movie", "tt9999999"), []);
  assert.deepEqual(await store.getStreams("series", "tt0903747:9:9"), []);
  assert.deepEqual(await store.getStreams("series", "tt0903747"), []); // no S:E
  assert.deepEqual(await store.getStreams("movie", "ttNaN"), []);
});

test("TMDB-based addons work too (tmdb: ids)", async () => {
  // index ids encode the TMDB id: wbx:movie:t550 / wbx:series:t1396
  const movie = await store.getStreams("movie", "tmdb:550");
  assert.equal(movie.length, 1, "one record per TMDB id");
  assert.ok(movie[0].url.endsWith("Movies/Fight.Club.1080p.mkv"));
  assert.equal((await store.getStreams("movie", "tmdb:551")).length, 1);
  const ep = await store.getStreams("series", "tmdb:1396:2:5");
  assert.equal(ep.length, 1);
  assert.ok(ep[0].url.endsWith("TV/BB.S02E05.mkv"));
  assert.deepEqual(await store.getStreams("movie", "tmdb:999999"), []);
});

test("stream claims both tt and tmdb: prefixes", () => {
  const stream = resourceNamed("stream");
  assert.ok(stream.idPrefixes.includes("tt"));
  assert.ok(stream.idPrefixes.includes("tmdb:"));
  const meta = resourceNamed("meta");
  assert.ok(!meta.idPrefixes.includes("tmdb:"), "meta must not claim tmdb: either");
});

test("our own wbx: ids still resolve (no regression)", async () => {
  const streams = await store.getStreams("movie", "wbx:movie:t550");
  assert.equal(streams.length, 1);
  assert.ok(streams[0].url.endsWith("Movies/Fight.Club.1080p.mkv"));
});

test("sidecar subtitles are served for a bridged IMDb id too", async () => {
  const subs = await store.getSubtitles("movie", "tt0137523");
  assert.equal(subs.length, 1);
  assert.equal(subs[0].lang, "en");
  assert.match(subs[0].url, /\/sub\/.+\.srt$/);
});
