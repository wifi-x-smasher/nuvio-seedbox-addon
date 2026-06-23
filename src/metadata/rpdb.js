"use strict";

// RPDB (RatingPosterDB) posters — TMDB posters with rating badges baked in.
// Applied at serve time so the API key stays out of the index and RPDB can be
// toggled (add/remove the key) without re-scanning. fallback=true makes RPDB
// return the plain poster when it has no rating for that title.

const settings = require("../settings");

const BASE = "https://api.ratingposterdb.com";

function enabled() {
  return Boolean(settings.get("rpdbKey"));
}

// type: "movie" | "series"; tmdbId: number. Returns null if disabled/no id.
function posterUrl(type, tmdbId) {
  const key = settings.get("rpdbKey");
  if (!key || !tmdbId) return null;
  const seg = type === "series" ? "series" : "movie";
  return `${BASE}/${key}/tmdb/poster-default/${seg}-${tmdbId}.jpg?fallback=true`;
}

module.exports = { enabled, posterUrl };
