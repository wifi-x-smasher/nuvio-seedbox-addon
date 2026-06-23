"use strict";

// Detail-page enrichment. Nuvio renders a lot of meta fields (cast w/ photos,
// ratings, runtime, certification, trailers, logo, per-episode stills/overviews)
// straight from the addon's meta response. We have the TMDB id for every
// matched item, so we fetch the full TMDB detail (lazily, on meta open) and map
// it into those fields. Results cache to data/meta-cache.json so repeat opens
// are instant.

const fs = require("fs");
const path = require("path");
const tmdb = require("./tmdb");
const config = require("../config");

const CACHE_FILE = path.join(config.dataDir, "meta-cache.json");
const IMG = "https://image.tmdb.org/t/p";

let cache = null;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}

const img = (p, size) => (p ? `${IMG}/${size}${p}` : null);

function fmtRuntime(min) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function pickLogo(images) {
  const logos = (images && images.logos) || [];
  if (logos.length === 0) return null;
  // Prefer English, then language-neutral, then the most-voted, then first.
  const byVotes = [...logos].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  const pick =
    logos.find((l) => l.iso_639_1 === "en") ||
    logos.find((l) => !l.iso_639_1) ||
    byVotes[0];
  return pick ? img(pick.file_path, "w500") : null;
}

function trailers(videos) {
  return ((videos && videos.results) || [])
    .filter((v) => v.site === "YouTube" && /Trailer|Teaser/i.test(v.type))
    .slice(0, 8)
    .map((v) => ({
      key: v.key,
      name: v.name,
      site: "YouTube",
      type: v.type,
      official: Boolean(v.official),
    }));
}

function castOf(credits) {
  return ((credits && credits.cast) || []).slice(0, 20).map((c) => ({
    name: c.name,
    character: c.character || null,
    photo: img(c.profile_path, "w185"),
  }));
}

function crewByJob(credits, jobs) {
  return ((credits && credits.crew) || [])
    .filter((c) => jobs.includes(c.job))
    .map((c) => c.name)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function rating(voteAverage) {
  return voteAverage ? String(Math.round(voteAverage * 10) / 10) : null;
}

function movieCert(releaseDates) {
  const us = ((releaseDates && releaseDates.results) || []).find((r) => r.iso_3166_1 === "US");
  return (us && (us.release_dates || []).map((d) => d.certification).find(Boolean)) || null;
}

function tvCert(contentRatings) {
  const us = ((contentRatings && contentRatings.results) || []).find((r) => r.iso_3166_1 === "US");
  return (us && us.rating) || null;
}

async function buildMovie(tmdbId) {
  const d = await tmdb.movieFull(tmdbId);
  if (!d) return null;
  return {
    logo: pickLogo(d.images),
    imdbRating: rating(d.vote_average),
    ageRating: movieCert(d.release_dates),
    runtime: fmtRuntime(d.runtime),
    cast: castOf(d.credits),
    director: crewByJob(d.credits, ["Director"]),
    writer: crewByJob(d.credits, ["Writer", "Screenplay"]),
    country: (d.production_countries && d.production_countries[0] && d.production_countries[0].name) || null,
    language: d.original_language || null,
    trailers: trailers(d.videos),
  };
}

async function buildSeries(item, tmdbId) {
  const d = await tmdb.tvFull(tmdbId);
  if (!d) return null;
  const e = {
    logo: pickLogo(d.images),
    imdbRating: rating(d.vote_average),
    ageRating: tvCert(d.content_ratings),
    runtime: fmtRuntime((d.episode_run_time && d.episode_run_time[0]) || 0),
    cast: castOf(d.credits),
    director: crewByJob(d.credits, ["Director"]),
    writer: crewByJob(d.credits, ["Writer", "Screenplay"]),
    country: (d.origin_country && d.origin_country[0]) || null,
    language: d.original_language || null,
    trailers: trailers(d.videos),
    status: d.status || null,
    lastAirDate: d.last_air_date || null,
    episodes: {},
  };

  // Per-episode stills/overviews/titles from each season we have files for.
  const seasons = [...new Set((item.episodes || []).map((ep) => ep.season))];
  for (const s of seasons) {
    const sd = await tmdb.tvSeason(tmdbId, s).catch(() => null);
    for (const ep of (sd && sd.episodes) || []) {
      e.episodes[`${s}:${ep.episode_number}`] = {
        name: ep.name || null,
        overview: ep.overview || null,
        thumbnail: img(ep.still_path, "w300"),
        released: ep.air_date || null,
        runtime: ep.runtime || null,
      };
    }
  }
  return e;
}

// Returns the enrichment object for an item (cached), or null.
async function enrich(item, tmdbId) {
  if (!tmdbId) return null;
  if (!cache) cache = loadCache();
  if (Object.prototype.hasOwnProperty.call(cache, item.id)) return cache[item.id];

  let result = null;
  try {
    result = item.type === "series" ? await buildSeries(item, tmdbId) : await buildMovie(tmdbId);
  } catch {
    return null; // transient — don't cache, retry next open
  }
  if (result) {
    cache[item.id] = result;
    saveCache();
  }
  return result;
}

module.exports = { enrich };
