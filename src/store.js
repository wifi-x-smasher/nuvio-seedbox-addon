"use strict";

// Read/write the local index that the scanner builds, and serve Stremio
// objects from it. Index is a JSON file under data/ (gitignored).
//
// Record shapes:
//   movie : { id, type:"movie", name, year, poster, background, description,
//             genres, quality, container, streamPath, subs:[{path,lang,format}] }
//   series: { id, type:"series", name, year, poster, background, description,
//             genres, imdbId,
//             episodes:[{ season, episode, title, streamPath, container,
//                         quality, subs:[{path,lang,format}] }] }
//
// Stremio addresses a series episode by the id "<seriesId>:<season>:<episode>"
// (the video ids we put in the series meta). Movies use the bare item id.

const fs = require("fs");
const path = require("path");
const wb = require("./seedbox/client");
const config = require("./config");
const settings = require("./settings");
const relay = require("./subs/relay");
const rpdb = require("./metadata/rpdb");
const betterposters = require("./metadata/betterposters");
const enrichment = require("./metadata/enrich");

const DATA_DIR = config.dataDir;
const INDEX_FILE = path.join(DATA_DIR, "index.json");

function emptyIndex() {
  return { movies: [], series: [], orphanSubs: [], skippedFolders: [], updatedAt: null };
}

function loadIndex() {
  try {
    const raw = fs.readFileSync(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      movies: parsed.movies || [],
      series: parsed.series || [],
      orphanSubs: parsed.orphanSubs || [],
      skippedFolders: parsed.skippedFolders || [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return emptyIndex();
  }
}

function saveIndex(index) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = { ...index, updatedAt: new Date().toISOString() };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function matchesSearch(item, search) {
  if (!search) return true;
  return item.name && item.name.toLowerCase().includes(search.toLowerCase());
}

function source(type) {
  return type === "series" ? loadIndex().series : loadIndex().movies;
}

// Extract the TMDB id from a matched item id ("wbx:movie:t123" -> 123).
function tmdbIdFromId(id) {
  const m = id.match(/^wbx:(?:movie|series):t(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Choose a poster by the configured preference order, falling back through the
// available sources to the stored TMDB poster.
function posterFor(item) {
  // Only use BetterPosters when the scanner verified btttr.cc actually has it
  // (it 404s with no fallback image otherwise), so RPDB/TMDB can take over.
  const bp = item.bpOk ? betterposters.posterUrl(item.imdbId) : null;
  const rp = rpdb.posterUrl(item.type, tmdbIdFromId(item.id));
  const tmdb = item.poster || null;

  const source = settings.get("posterSource");
  let order;
  if (source === "tmdb") order = [tmdb];
  else if (source === "rpdb") order = [rp, bp, tmdb];
  else order = [bp, rp, tmdb]; // "better" (default)

  return order.find(Boolean) || null;
}

// "<seriesId>:<season>:<episode>" -> { seriesId, season, episode } (or null).
function parseEpisodeId(id) {
  const parts = id.split(":");
  if (parts.length < 5) return null; // wbx : series : <key> : <S> : <E>
  const episode = Number(parts.pop());
  const season = Number(parts.pop());
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { seriesId: parts.join(":"), season, episode };
}

// Resolve a playable target (movie or series episode) to its stream/subs.
function resolvePlayable(type, id) {
  if (type === "series") {
    const ep = parseEpisodeId(id);
    if (!ep) return null;
    const series = loadIndex().series.find((s) => s.id === ep.seriesId);
    if (!series) return null;
    const e = (series.episodes || []).find(
      (x) => x.season === ep.season && x.episode === ep.episode,
    );
    if (!e) return null;
    return {
      streamPath: e.streamPath,
      container: e.container,
      quality: e.quality,
      subs: e.subs || [],
      label: `S${ep.season}E${ep.episode}`,
    };
  }
  const m = loadIndex().movies.find((it) => it.id === id);
  if (!m) return null;
  return {
    streamPath: m.streamPath,
    container: m.container,
    quality: m.quality,
    subs: m.subs || [],
    label: null,
  };
}

const KNOWN_LANGS = ["ko", "zh", "ja", "th"];

// Map a series catalog id ("wbx-series-ko", "wbx-series-other") to a predicate.
function seriesLangPredicate(catalogId) {
  const m = catalogId && catalogId.match(/^wbx-series-(.+)$/);
  if (!m) return null; // not language-scoped -> no filter
  const code = m[1];
  if (code === "other") return (s) => !KNOWN_LANGS.includes(s.lang);
  return (s) => s.lang === code;
}

async function listCatalog(type, { search, skip, catalogId } = {}) {
  // We return the whole library in one page; for any paginated follow-up
  // request (skip > 0) return nothing so Nuvio doesn't duplicate the list.
  if (Number(skip) > 0) return [];

  let items = source(type).filter((item) => matchesSearch(item, search));

  if (type === "series") {
    const pred = seriesLangPredicate(catalogId);
    if (pred) items = items.filter(pred);
  }

  return items.map((item) => ({
    id: item.id,
    type: item.type,
    name: item.name,
    poster: posterFor(item),
  }));
}

async function getMeta(type, id) {
  const item = source(type).find((it) => it.id === id);
  if (!item) return null;

  const meta = {
    id: item.id,
    type: item.type,
    name: item.name,
    poster: posterFor(item),
    background: item.background || null,
    description: item.description || "",
    genres: item.genres || [],
    releaseInfo: item.year || undefined,
  };

  // Lazily enrich with full TMDB detail (cast, ratings, runtime, trailers,
  // logo, per-episode stills/overviews). Cached after first open.
  const e = await enrichment.enrich(item, tmdbIdFromId(item.id));
  if (e) {
    if (e.logo) meta.logo = e.logo;
    if (e.imdbRating) meta.imdbRating = e.imdbRating;
    if (e.ageRating) meta.ageRating = e.ageRating;
    if (e.runtime) meta.runtime = e.runtime;
    if (e.country) meta.country = e.country;
    if (e.language) meta.language = e.language;
    if (e.status) meta.status = e.status;
    if (e.lastAirDate) meta.lastAirDate = e.lastAirDate;
    if (e.director && e.director.length) meta.director = e.director;
    if (e.writer && e.writer.length) meta.writer = e.writer;
    if (e.cast && e.cast.length) meta.app_extras = { cast: e.cast };
    if (e.trailers && e.trailers.length) meta.trailers = e.trailers;
  }

  if (item.type === "series") {
    const eps = (e && e.episodes) || {};
    meta.videos = (item.episodes || []).map((ep) => {
      const x = eps[`${ep.season}:${ep.episode}`] || {};
      return {
        id: `${item.id}:${ep.season}:${ep.episode}`,
        title: x.name || ep.title || `Episode ${ep.episode}`,
        season: ep.season,
        episode: ep.episode,
        thumbnail: x.thumbnail || null,
        overview: x.overview || null,
        released: x.released || null,
        runtime: x.runtime || undefined,
      };
    });
  }

  return meta;
}

async function getStreams(type, id) {
  const target = resolvePlayable(type, id);
  if (!target || !target.streamPath) return [];

  const stream = {
    url: wb.fileUrl(target.streamPath),
    name: settings.get("addonName"),
    title:
      [target.label, target.quality, target.container].filter(Boolean).join(" ") ||
      "Direct",
  };

  // Attach Basic auth so the player fetches directly from the seedbox, no relay.
  const auth = wb.authHeaderValue();
  if (auth) {
    stream.behaviorHints = { proxyHeaders: { request: { Authorization: auth } } };
  }

  return [stream];
}

async function getSubtitles(type, id, extra) {
  void extra;
  const target = resolvePlayable(type, id);
  if (!target || target.subs.length === 0) return [];

  const base = settings.publicUrl().replace(/\/+$/, "");
  return target.subs.map((sub, i) => {
    const token = relay.encodeToken(sub.path);
    // ASS/SSA are converted to SRT by the relay, so hint .srt to the player.
    const fmt = sub.format === "ass" || sub.format === "ssa" ? "srt" : sub.format;
    const ext = fmt ? `.${fmt}` : "";
    // Sidecar subs here carry no language tag in their filename; for this
    // library they are always English, so default undetected to "eng".
    const lang = sub.lang && sub.lang !== "und" ? sub.lang : "eng";
    return {
      id: `wbx-sub-${i}-${lang}`,
      url: `${base}/sub/${token}${ext}`,
      lang,
    };
  });
}

module.exports = {
  emptyIndex,
  loadIndex,
  saveIndex,
  listCatalog,
  getMeta,
  getStreams,
  getSubtitles,
};
