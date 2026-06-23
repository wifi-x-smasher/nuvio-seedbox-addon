"use strict";

// Manual metadata overrides, highest priority in the matcher chain. Edit
// overrides.json at the project root to pin specific releases that automatic
// matching gets wrong or can't find. Keyed by the exact folder name.
//
// Shapes (per key):
//   { "tmdbId": 12345 }            -> fetch that TMDB id directly (most precise)
//   { "title": "X", "year": 2024 } -> re-run the scored matcher with this title

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "overrides.json");

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      movies: parsed.movies || {},
      series: parsed.series || {},
    };
  } catch {
    return { movies: {}, series: {} };
  }
}

// Pin a TMDB id for a movie/series by its exact key (movie filename or series
// folder name). Used by the admin "unmatched fixer". Preserves the _help note.
function set(type, key, tmdbId) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    data = { movies: {}, series: {} };
  }
  if (!data.movies) data.movies = {};
  if (!data.series) data.series = {};
  const bucket = type === "movie" ? "movies" : "series";
  data[bucket][key] = { tmdbId: Number(tmdbId) };
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { load, set };
