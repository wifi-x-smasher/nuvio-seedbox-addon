"use strict";

// Manual metadata overrides, highest priority in the matcher chain. They pin
// specific releases that automatic matching gets wrong or can't find, keyed by
// the exact movie filename or series folder name.
//
// Stored at <DATA_DIR>/overrides.json (per-instance, gitignored) so the admin
// "unmatched fixer" can write to it without dirtying the repo. An empty
// overrides.example.json at the project root documents the format.
//
// Shapes (per key):
//   { "tmdbId": 12345 }            -> fetch that TMDB id directly (most precise)
//   { "title": "X", "year": 2024 } -> re-run the scored matcher with this title

const fs = require("fs");
const path = require("path");
const config = require("./config");

const FILE = path.join(config.dataDir, "overrides.json");

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
// folder name). Used by the admin "unmatched fixer".
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
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { load, set };
