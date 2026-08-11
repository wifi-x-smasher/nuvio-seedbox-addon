"use strict";

// Gap report logic. The two rules that decide whether this feature is useful or
// pure noise: only AIRED episodes count as missing, and specials are excluded.

const test = require("node:test");
const assert = require("node:assert/strict");

const { analyse, tmdbIdOf } = require("../src/gaps/report");

const PAST = "2020-01-01";
const FUTURE = "2999-01-01";

// season map helper: episodes 1..n with the given air date
const season = (n, date) => Array.from({ length: n }, (_, i) => ({ e: i + 1, d: date }));

function series(episodes) {
  return { id: "wbx:series:t1396", name: "Test Show", episodes };
}
const held = (s, e) => ({ season: s, episode: e });

test("tmdbIdOf extracts the id, and ignores unmatched ids", () => {
  assert.equal(tmdbIdOf("wbx:series:t1396"), 1396);
  assert.equal(tmdbIdOf("wbx:series:f0abc12345"), null);
  assert.equal(tmdbIdOf("wbx:movie:t550"), null); // series-only
});

test("reports the aired episodes we do not have", () => {
  const data = { status: "Ended", seasons: { 1: season(4, PAST) } };
  const r = analyse(series([held(1, 1), held(1, 3)]), data);
  assert.equal(r.complete, false);
  assert.equal(r.airedTotal, 4);
  assert.equal(r.haveTotal, 2);
  assert.deepEqual(r.seasons[0].missing, [2, 4]);
});

test("a complete season reports complete, with no season rows", () => {
  const data = { status: "Ended", seasons: { 1: season(3, PAST) } };
  const r = analyse(series([held(1, 1), held(1, 2), held(1, 3)]), data);
  assert.equal(r.complete, true);
  assert.equal(r.missingCount, 0);
  assert.deepEqual(r.seasons, []);
});

test("UNAIRED episodes are never counted as missing", () => {
  // 2 aired (held) + 3 future -> complete, not "3 missing"
  const data = {
    status: "Returning Series",
    seasons: { 1: [...season(2, PAST), { e: 3, d: FUTURE }, { e: 4, d: FUTURE }, { e: 5, d: null }] },
  };
  const r = analyse(series([held(1, 1), held(1, 2)]), data);
  assert.equal(r.complete, true, "an ongoing show should not report its future season");
  assert.equal(r.airedTotal, 2);
});

test("episodes with no air date are ignored", () => {
  const data = { status: "Ended", seasons: { 1: [{ e: 1, d: null }, { e: 2, d: null }] } };
  const r = analyse(series([]), data);
  assert.equal(r.airedTotal, 0);
  assert.equal(r.complete, true);
});

test("a season we hold NOTHING from is fully reported", () => {
  // the gap enrich.js couldn't see: it only fetches seasons that have files
  const data = { status: "Ended", seasons: { 1: season(2, PAST), 2: season(3, PAST) } };
  const r = analyse(series([held(1, 1), held(1, 2)]), data);
  assert.equal(r.missingCount, 3);
  assert.equal(r.seasons.length, 1);
  assert.equal(r.seasons[0].season, 2);
  assert.deepEqual(r.seasons[0].missing, [1, 2, 3]);
});

test("specials (season 0) are excluded by default", () => {
  const data = { status: "Ended", seasons: { 0: season(5, PAST), 1: season(2, PAST) } };
  const r = analyse(series([held(1, 1), held(1, 2)]), data);
  assert.equal(r.complete, true, "season 0 must not create a gap");
  assert.equal(r.airedTotal, 2);
});

test("a wildly-off episode count is flagged as a probable wrong match", () => {
  // real case: a 16-episode WEB-DL release matched to a 115-episode 1972 show
  const data = { status: "Ended", seasons: { 1: season(115, PAST) } };
  const held16 = Array.from({ length: 16 }, (_, i) => held(1, i + 1));
  const r = analyse(series(held16), data);
  assert.equal(r.suspectMismatch, true);
});

test("a wholly missing season is a real gap, NOT a mismatch", () => {
  // we hold all of S1; S2 simply isn't downloaded yet. Comparing totals (10 vs
  // 30) would wrongly cry "wrong match" — the check is per season.
  const data = { status: "Ended", seasons: { 1: season(10, PAST), 2: season(20, PAST) } };
  const held10 = Array.from({ length: 10 }, (_, i) => held(1, i + 1));
  const r = analyse(series(held10), data);
  assert.equal(r.missingCount, 20);
  assert.equal(r.suspectMismatch, false, "missing a whole season is a genuine gap");
});

test("an ordinary gap is NOT flagged as a mismatch", () => {
  const data = { status: "Ended", seasons: { 1: season(12, PAST) } };
  const held10 = Array.from({ length: 10 }, (_, i) => held(1, i + 1));
  const r = analyse(series(held10), data);
  assert.equal(r.missingCount, 2);
  assert.equal(r.suspectMismatch, false);
});

test("counts across multiple seasons add up", () => {
  const data = { status: "Ended", seasons: { 1: season(3, PAST), 2: season(3, PAST) } };
  const r = analyse(series([held(1, 1), held(2, 2)]), data);
  assert.equal(r.airedTotal, 6);
  assert.equal(r.haveTotal, 2);
  assert.equal(r.missingCount, 4);
  assert.equal(r.seasons.length, 2);
});
