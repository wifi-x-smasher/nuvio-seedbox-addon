"use strict";

const settings = require("../settings");

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

function apiKey() {
  const k = settings.get("tmdbKey");
  if (!k) throw new Error("TMDB API key is not set");
  return k;
}

function img(path, size) {
  return path ? `${IMG}/${size}${path}` : null;
}

async function getJson(path, params = {}) {
  const url = new URL(API + path);
  url.searchParams.set("api_key", apiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// include_adult=true is required or TMDB hides adult titles (pink films, erotic
// dramas) from search results, even though they exist and are fetchable by id.

async function searchMovie(title, year) {
  const data = await getJson("/search/movie", { query: title, year, include_adult: true });
  return (data && data.results && data.results[0]) || null;
}

async function searchMovieAll(title) {
  const data = await getJson("/search/movie", { query: title, include_adult: true });
  return (data && data.results) || [];
}

async function movieDetails(id) {
  return getJson(`/movie/${id}`, { append_to_response: "external_ids" });
}

// Full detail payloads for meta enrichment (cast, crew, trailers, certs, logo).
// No include_image_language filter: many non-English titles only have a logo in
// their original language (e.g. the Chinese logo for "19th Floor"). enrich.js
// picks the best available (English first, then language-neutral, then any).
async function movieFull(id) {
  return getJson(`/movie/${id}`, {
    append_to_response: "credits,videos,release_dates,images,external_ids",
  });
}

async function tvFull(id) {
  return getJson(`/tv/${id}`, {
    append_to_response: "credits,videos,content_ratings,images,external_ids",
  });
}

async function tvSeason(id, season) {
  return getJson(`/tv/${id}/season/${season}`);
}

async function searchTv(title, year) {
  const data = await getJson("/search/tv", {
    query: title,
    first_air_date_year: year,
    include_adult: true,
  });
  return (data && data.results && data.results[0]) || null;
}

async function searchTvAll(title) {
  const data = await getJson("/search/tv", { query: title, include_adult: true });
  return (data && data.results) || [];
}

async function tvDetails(id) {
  return getJson(`/tv/${id}`, { append_to_response: "external_ids" });
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Common fields across movie and tv candidate shapes (movies use title/
// release_date, tv uses name/first_air_date).
function candidateFields(c) {
  return {
    names: [norm(c.name || c.title), norm(c.original_name || c.original_title)],
    cy: ((c.first_air_date || c.release_date) || "").slice(0, 4),
    isAnime: (c.genre_ids || []).includes(16),
    lang: c.original_language,
    popularity: c.popularity || 0,
  };
}

// Score a TMDB candidate against the release we're trying to match. Bigger is
// better; the caller leaves the title raw if nothing clears the threshold.
function scoreCandidate(c, nt, year, opts) {
  const f = candidateFields(c);
  let score = 0;

  if (f.names.includes(nt)) score += 6;
  else if (f.names.some((n) => n && (n.includes(nt) || nt.includes(n)))) score += 2;

  // If a candidate's NAME contains the year number, the year is part of the
  // title (e.g. "Reply 1994", which aired 2013) — a very strong signal, and we
  // must NOT then penalise it on air-date proximity. Otherwise use proximity.
  const yearTok = year ? String(year) : null;
  const nameHasYear = yearTok && f.names.some((n) => n.split(" ").includes(yearTok));
  if (nameHasYear) {
    score += 8;
  } else if (year && f.cy) {
    const d = Math.abs(Number(f.cy) - year);
    score += d === 0 ? 4 : d === 1 ? 2 : d <= 3 ? 0 : -2;
  }

  // Anime vs live-action: the #1 source of wrong matches in this library.
  score += f.isAnime === Boolean(opts.anime) ? 2 : -3;

  // Origin language hint from streaming-platform tags (when unambiguous).
  if (opts.lang) score += f.lang === opts.lang ? 3 : -2;

  score += Math.min(f.popularity / 100, 1); // tiny popularity tiebreak
  return score;
}

// Pick the best-scoring candidate from a pool, or null if none clears threshold.
function pickBest(candidates, title, year, opts) {
  const nt = norm(title);
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreCandidate(c, nt, year, opts);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best && bestScore >= 4 ? best : null;
}

// Build the result shape from a movie candidate/detail pair.
function movieResult(c, det, title, year) {
  return {
    tmdbId: c.id,
    imdbId: (det && (det.imdb_id || det.external_ids?.imdb_id)) || c.imdb_id || null,
    name: c.title || (det && det.title) || title,
    year: (c.release_date || (det && det.release_date) || "").slice(0, 4) || (year ? String(year) : null),
    poster: img(c.poster_path || (det && det.poster_path), "w500"),
    background: img(c.backdrop_path || (det && det.backdrop_path), "w1280"),
    description: (det && det.overview) || c.overview || "",
    genres: det && det.genres ? det.genres.map((g) => g.name) : [],
    lang: c.original_language || (det && det.original_language) || null,
  };
}

function tvResult(c, det, title, year) {
  return {
    tmdbId: c.id,
    imdbId: (det && (det.external_ids?.imdb_id || det.imdb_id)) || null,
    name: c.name || (det && det.name) || title,
    year: (c.first_air_date || (det && det.first_air_date) || "").slice(0, 4) || (year ? String(year) : null),
    poster: img(c.poster_path || (det && det.poster_path), "w500"),
    background: img(c.backdrop_path || (det && det.backdrop_path), "w1280"),
    description: (det && det.overview) || c.overview || "",
    genres: det && det.genres ? det.genres.map((g) => g.name) : [],
    lang: c.original_language || (det && det.original_language) || null,
  };
}

// Best-effort match with candidate scoring. Returns null if nothing is
// confident enough (caller keeps the raw title — better than a wrong match).
//
// opts: { anime?: boolean, lang?: string } — hints derived from the release
// name (anime fansub tags, region-exclusive platform tags).
//
// We try the year as part of the query first (no date filter). That only adds
// candidates when the number is part of the name (e.g. "Reply 1994", which
// actually first aired in 2013, so a first_air_date_year filter would miss it).
async function matchMovie(title, year, opts = {}) {
  const pool = new Map();
  const add = (arr) => {
    for (const c of arr) if (!pool.has(c.id)) pool.set(c.id, c);
  };
  if (year) add(await searchMovieAll(`${title} ${year}`));
  add(await searchMovieAll(title));
  if (pool.size === 0) return null;

  const best = pickBest([...pool.values()], title, year, opts);
  if (!best) return null;
  const det = await movieDetails(best.id).catch(() => null);
  return movieResult(best, det, title, year);
}

async function matchSeries(title, year, opts = {}) {
  const pool = new Map();
  const add = (arr) => {
    for (const c of arr) if (!pool.has(c.id)) pool.set(c.id, c);
  };
  if (year) add(await searchTvAll(`${title} ${year}`));
  add(await searchTvAll(title));
  if (pool.size === 0) return null;

  const best = pickBest([...pool.values()], title, year, opts);
  if (!best) return null;
  const det = await tvDetails(best.id).catch(() => null);
  return tvResult(best, det, title, year);
}

// Build a match object directly from a TMDB id (used by manual overrides).
async function movieById(id) {
  const det = await movieDetails(id);
  if (!det) return null;
  return movieResult(det, det, det.title, null);
}

async function seriesById(id) {
  const det = await tvDetails(id);
  if (!det) return null;
  return tvResult(det, det, det.name, null);
}

module.exports = {
  searchMovie,
  searchMovieAll,
  movieDetails,
  movieFull,
  movieById,
  matchMovie,
  searchTv,
  searchTvAll,
  tvDetails,
  tvFull,
  tvSeason,
  seriesById,
  matchSeries,
  img,
};
