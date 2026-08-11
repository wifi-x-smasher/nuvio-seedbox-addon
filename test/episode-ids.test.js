"use strict";

// Series episodes carry IMDb-based video ids so external subtitle add-ons (which
// only answer for "tt") work when browsing our own catalog rows. Env must be set
// BEFORE requiring config; node --test runs each file in its own process.

const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wbx-epids-"));
process.env.DATA_DIR = DATA_DIR;
process.env.SEEDBOX_HTTP_BASE_URL = "https://box.example.com/private/";
process.env.SEEDBOX_HTTP_USER = "u";
process.env.SEEDBOX_HTTP_PASS = "p";
// Keep enrichment offline: with no key it fails fast and getMeta still builds.
process.env.TMDB_API_KEY = "";

const EPISODES = [
  { season: 1, episode: 1, streamPath: "TV/BB.S01E01.mkv", container: "mkv", quality: "1080p", subs: [] },
  { season: 2, episode: 5, streamPath: "TV/BB.S02E05.mkv", container: "mkv", quality: "720p", subs: [] },
];

fs.writeFileSync(
  path.join(DATA_DIR, "index.json"),
  JSON.stringify({
    movies: [],
    series: [
      { id: "wbx:series:t1396", type: "series", name: "Breaking Bad", imdbId: "tt0903747",
        matched: true, episodes: EPISODES },
      // no imdbId -> must keep our own ids, or it would be unplayable
      { id: "wbx:series:f0abc12345", type: "series", name: "Unmatched Show", matched: false,
        episodes: [{ season: 1, episode: 1, streamPath: "TV/UN.S01E01.mkv", container: "mkv", subs: [] }] },
    ],
    orphanSubs: [], skippedFolders: [], updatedAt: null,
  }),
  "utf8",
);

const test = require("node:test");
const assert = require("node:assert/strict");
const settingsFile = path.join(DATA_DIR, "settings.json");
const store = require("../src/store");

function setSettings(obj) {
  fs.writeFileSync(settingsFile, JSON.stringify(obj), "utf8");
}

test("episodes get IMDb-based video ids by default", async () => {
  setSettings({});
  const meta = await store.getMeta("series", "wbx:series:t1396");
  assert.deepEqual(
    meta.videos.map((v) => v.id),
    ["tt0903747:1:1", "tt0903747:2:5"],
  );
  // season/episode fields stay intact so the client still groups them correctly
  assert.equal(meta.videos[1].season, 2);
  assert.equal(meta.videos[1].episode, 5);
});

test("ROUND TRIP: an id from getMeta resolves back to the right file", async () => {
  setSettings({});
  const meta = await store.getMeta("series", "wbx:series:t1396");
  for (const v of meta.videos) {
    const streams = await store.getStreams("series", v.id);
    assert.equal(streams.length, 1, `no stream for ${v.id}`);
    assert.ok(
      streams[0].url.endsWith(`TV/BB.S0${v.season}E0${v.episode}.mkv`),
      `${v.id} -> ${streams[0].url}`,
    );
  }
});

test("a series with no imdbId keeps our own ids (still playable)", async () => {
  setSettings({});
  const meta = await store.getMeta("series", "wbx:series:f0abc12345");
  assert.deepEqual(meta.videos.map((v) => v.id), ["wbx:series:f0abc12345:1:1"]);
  const streams = await store.getStreams("series", meta.videos[0].id);
  assert.equal(streams.length, 1, "must remain playable");
});

test("turning the feature off falls back to our own ids", async () => {
  setSettings({ episodeIdsUseImdb: "off" });
  const meta = await store.getMeta("series", "wbx:series:t1396");
  assert.deepEqual(meta.videos.map((v) => v.id), ["wbx:series:t1396:1:1", "wbx:series:t1396:2:5"]);
  const streams = await store.getStreams("series", meta.videos[0].id);
  assert.equal(streams.length, 1);
});

test("SAFETY: bridging off forces our own ids, or episodes would be unplayable", async () => {
  // tt ids are only resolvable because our bridge understands them
  setSettings({ bridgeImdbIds: "off", episodeIdsUseImdb: "on" });
  const meta = await store.getMeta("series", "wbx:series:t1396");
  assert.ok(meta.videos[0].id.startsWith("wbx:series:"), "must not hand out unresolvable tt ids");
  const streams = await store.getStreams("series", meta.videos[0].id);
  assert.equal(streams.length, 1, "still playable with bridging off");
  // and the tt form is correctly refused while bridging is off
  assert.deepEqual(await store.getStreams("series", "tt0903747:1:1"), []);
});
