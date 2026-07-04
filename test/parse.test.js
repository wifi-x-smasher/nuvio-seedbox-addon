"use strict";

// Unit tests for the filename parser — the highest-regression-risk pure logic
// in the scanner. Run with: npm test  (uses node:test, no extra deps).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseName,
  subtitleLang,
  parseFolderTitle,
  parseEpisode,
  normalizeTitle,
  looksLikeAnime,
  inferOriginLang,
} = require("../src/indexer/parse");

test("parseName: movie -> title/year, not a series", () => {
  const r = parseName("Fight.Club.1999.1080p.BluRay.mkv");
  assert.equal(r.title, "Fight Club");
  assert.equal(r.year, 1999);
  assert.equal(r.resolution, "1080p");
  assert.equal(r.isSeries, false);
});

test("parseName: episode -> season/episode, isSeries true", () => {
  const r = parseName("Breaking.Bad.S01E01.720p.mkv");
  assert.equal(r.season, 1);
  assert.equal(r.episode, 1);
  assert.equal(r.isSeries, true);
});

test("parseEpisode: SxxExx", () => {
  assert.deepEqual(parseEpisode("Show.S02E05.mkv"), { season: 2, episode: 5 });
});

test("parseEpisode: 1x03 style", () => {
  assert.deepEqual(parseEpisode("Show 1x03.mkv"), { season: 1, episode: 3 });
});

test("parseEpisode: bare E/EP with unknown season", () => {
  assert.deepEqual(parseEpisode("Some Show EP07.mkv"), { season: null, episode: 7 });
});

test("parseEpisode: fansub ' - NN ' style", () => {
  assert.deepEqual(parseEpisode("[NOP] Last Cinderella - 01 [1080p].mkv"), {
    season: null,
    episode: 1,
  });
});

test("parseEpisode: no episode number", () => {
  assert.deepEqual(parseEpisode("A Movie Title.mkv"), { season: null, episode: null });
});

test("parseFolderTitle: strips season/quality but keeps the title", () => {
  const r = parseFolderTitle("Switch.Girl.S02.1080p.WEB-DL");
  assert.equal(r.title, "Switch Girl");
  assert.equal(r.season, 2);
});

test("parseFolderTitle: year-in-name shows keep the year", () => {
  const r = parseFolderTitle("Reply.1994.1080p");
  assert.equal(r.year, 1994);
});

test("parseFolderTitle: drops a leading native-script segment", () => {
  const r = parseFolderTitle("我和我的时光少年 Flourish in Time");
  assert.ok(r.title.includes("Flourish in Time"), `got: ${r.title}`);
});

test("subtitleLang: language token right after the video base", () => {
  assert.equal(subtitleLang("Movie.Name.en", "Movie.Name"), "en");
});

test("subtitleLang: sniff trailing token when the base doesn't match", () => {
  assert.equal(subtitleLang("Different.Release.kor", "Movie.Name"), "kor");
});

test("subtitleLang: none found -> und", () => {
  assert.equal(subtitleLang("Movie.Name", "Movie.Name"), "und");
});

test("normalizeTitle: lowercases and strips punctuation", () => {
  assert.equal(normalizeTitle("Reply 1988!"), "reply 1988");
});

test("looksLikeAnime: fansub tag detected / plain name not", () => {
  assert.equal(looksLikeAnime("[SubsPlease] Frieren - 01 [1080p]"), true);
  assert.equal(looksLikeAnime("Normal Drama S01 1080p"), false);
});

test("inferOriginLang: single high-confidence tag", () => {
  assert.equal(inferOriginLang("Some.Show.TVING.WEB-DL.1080p"), "ko");
});

test("inferOriginLang: ambiguous (two languages) -> null", () => {
  assert.equal(inferOriginLang("Show.KBS.IQIYI.1080p"), null);
});

test("inferOriginLang: no tag -> null", () => {
  assert.equal(inferOriginLang("Show.1080p.WEB-DL"), null);
});
