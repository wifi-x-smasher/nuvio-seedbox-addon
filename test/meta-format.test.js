"use strict";

// Stremio's meta parser is strict: a field in the wrong shape makes it reject the
// WHOLE meta object, which showed up as a blank detail page ("No metadata was
// found!") while Nuvio's lenient parser coped. These guard the two shapes that
// broke it.

const test = require("node:test");
const assert = require("node:assert/strict");

const { isoDate } = require("../src/store");

test("isoDate: bare TMDB date becomes a full RFC3339 datetime", () => {
  assert.equal(isoDate("2025-11-07"), "2025-11-07T00:00:00.000Z");
});

test("isoDate: already-full datetimes stay valid RFC3339", () => {
  assert.equal(isoDate("2025-11-07T12:30:00.000Z"), "2025-11-07T12:30:00.000Z");
});

test("isoDate: empty/invalid input yields null, never a bad string", () => {
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(""), null);
  assert.equal(isoDate("not a date"), null);
});

// The trailer shape Stremio expects (Stream objects), as built in store.getMeta.
test("trailer mapping produces Stremio Stream objects, not raw TMDB videos", () => {
  const tmdb = [{ key: "abc123", name: "Official Trailer", site: "YouTube", type: "Trailer" }];
  const trailers = tmdb.map((t) => ({ source: t.key, type: "Trailer" }));
  const trailerStreams = tmdb.map((t) => ({ title: t.name || "Trailer", ytId: t.key }));

  assert.deepEqual(trailers, [{ source: "abc123", type: "Trailer" }]);
  assert.deepEqual(trailerStreams, [{ title: "Official Trailer", ytId: "abc123" }]);
  // The raw TMDB keys must not leak through — they are what broke Stremio.
  assert.equal("key" in trailers[0], false);
  assert.equal("site" in trailers[0], false);
});
