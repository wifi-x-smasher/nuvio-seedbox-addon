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
  // Write to a temp file then rename: rename is atomic on the same filesystem,
  // so a reader (or a crash mid-write) never sees a truncated/partial index.
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, INDEX_FILE);
}

// Stremio parses `released` as a full RFC3339 datetime; TMDB gives a bare date
// ("2025-11-07"), which fails to parse and takes the whole meta down with it.
function isoDate(d) {
  if (!d) return null;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
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

const KNOWN_LANGS = ["en", "ko", "zh", "ja", "th"];

// Map a series catalog id ("wbx-series-ko", "wbx-series-other") to a predicate.
function seriesLangPredicate(catalogId) {
  const m = catalogId && catalogId.match(/^wbx-series-(.+)$/);
  if (!m) return null; // not language-scoped -> no filter
  const code = m[1];
  if (code === "other") return (s) => !KNOWN_LANGS.includes(s.lang);
  return (s) => s.lang === code;
}

const PAGE_SIZE = 100; // Stremio pages catalogs in blocks of 100 via `skip`.

async function listCatalog(type, { search, skip, catalogId } = {}) {
  let items = source(type).filter((item) => matchesSearch(item, search));

  if (type === "series") {
    const pred = seriesLangPredicate(catalogId);
    if (pred) items = items.filter(pred);
  }

  // Page the results so large libraries scroll instead of returning everything
  // at once. `skip` is the offset Nuvio sends as the user scrolls; past the end
  // it slices to an empty page, which stops pagination cleanly.
  const start = Math.max(0, Number(skip) || 0);
  return items.slice(start, start + PAGE_SIZE).map((item) => ({
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
    // Spec field: lets clients cross-reference the title (some route subtitle
    // and rating lookups by it) even though our own id is in the "wbx:" space.
    imdb_id: item.imdbId || undefined,
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
    if (e.cast && e.cast.length) {
      // Standard Stremio field (names only) + the rich Nuvio extra (with photos).
      meta.cast = e.cast.map((c) => c.name).filter(Boolean);
      meta.app_extras = { cast: e.cast };
    }
    if (e.trailers && e.trailers.length) {
      // Stremio expects Stream objects here, NOT the raw TMDB video shape —
      // a non-conforming entry makes its (strict) parser reject the whole meta,
      // which shows up as a blank detail page in Stremio while Nuvio copes.
      meta.trailers = e.trailers.map((t) => ({ source: t.key, type: "Trailer" }));
      meta.trailerStreams = e.trailers.map((t) => ({ title: t.name || "Trailer", ytId: t.key }));
    }
  }

  if (item.type === "series") {
    const eps = (e && e.episodes) || {};
    // Prefer IMDb-based episode ids ("tt0903747:1:5"). External subtitle add-ons
    // only answer for "tt", so this makes them work when browsing our own rows —
    // and our bridging resolves the same id straight back to our file. Falls
    // back to our own id when there's no imdbId or the feature/bridging is off,
    // because a "tt" id nothing can resolve would be unplayable.
    const idBase = useImdbEpisodeIds() && item.imdbId ? item.imdbId : item.id;
    meta.videos = (item.episodes || []).map((ep) => {
      const x = eps[`${ep.season}:${ep.episode}`] || {};
      return {
        id: `${idBase}:${ep.season}:${ep.episode}`,
        title: x.name || ep.title || `Episode ${ep.episode}`,
        season: ep.season,
        episode: ep.episode,
        thumbnail: x.thumbnail || null,
        overview: x.overview || null,
        released: isoDate(x.released),
        runtime: x.runtime || undefined,
      };
    });
  }

  return meta;
}

// --- External id bridging --------------------------------------------------
// Stremio asks every add-on that claims an id prefix for streams, so with this
// on the library appears on ANY title's page — Cinemeta, search, another catalog
// — not just inside our own rows. Supported namespaces:
//   tt0137523 / tt0903747:1:5   IMDb  (Cinemeta and most catalogs)
//   tmdb:550  / tmdb:1396:1:5   TMDB  (the TMDB-based add-ons)
// Both are free for us: matched items store an imdbId, and their id encodes the
// TMDB id ("wbx:movie:t550"). We deliberately do NOT claim these for `meta`
// (see manifest.js), so Cinemeta keeps ownership of those detail pages.
const IMDB_ID = /^tt\d+$/;
const EXTERNAL_PREFIXES = ["tt", "tmdb:"];

function parseExternalId(id) {
  const p = String(id || "").split(":");
  if (p[0] === "tmdb" && /^\d+$/.test(p[1] || "")) {
    return { kind: "tmdb", key: p[1], season: p[2], episode: p[3] };
  }
  if (IMDB_ID.test(p[0])) {
    return { kind: "imdb", key: p[0], season: p[1], episode: p[2] };
  }
  return null;
}

function isExternalId(id) {
  return typeof id === "string" && EXTERNAL_PREFIXES.some((p) => id.startsWith(p));
}

function bridgeEnabled() {
  const v = settings.get("bridgeImdbIds");
  return !(v === false || v === "false" || v === "off" || v === "0" || v === "no");
}

// Whether series episodes should carry IMDb-based video ids. Hard-gated on
// bridging: those ids are only playable because our own resolver understands
// them, so with bridging off we must keep our native ids.
function useImdbEpisodeIds() {
  if (!bridgeEnabled()) return false;
  const v = settings.get("episodeIdsUseImdb");
  return !(v === false || v === "false" || v === "off" || v === "0" || v === "no");
}

// externalId -> items, rebuilt only when index.json actually changes.
let externalCache = { mtime: -1, imdb: null, tmdb: null };
function externalMaps() {
  let mtime = -1;
  try {
    mtime = fs.statSync(INDEX_FILE).mtimeMs;
  } catch {
    /* no index yet */
  }
  if (externalCache.imdb && externalCache.mtime === mtime) return externalCache;
  const idx = loadIndex();
  const maps = {
    imdb: { movies: new Map(), series: new Map() },
    tmdb: { movies: new Map(), series: new Map() },
  };
  const push = (map, key, val) => {
    const arr = map.get(key);
    if (arr) arr.push(val);
    else map.set(key, [val]);
  };
  const add = (bucket, item) => {
    if (item.imdbId) push(maps.imdb[bucket], String(item.imdbId), item);
    const t = tmdbIdFromId(item.id);
    if (t) push(maps.tmdb[bucket], String(t), item);
  };
  for (const m of idx.movies || []) add("movies", m);
  for (const s of idx.series || []) add("series", s);
  externalCache = { mtime, ...maps };
  return externalCache;
}

// Resolve a bridged external id to playable target(s). Several are possible when
// two records share an id (e.g. distinct TMDB entries for the same film).
function resolveExternalTargets(type, id) {
  if (!bridgeEnabled()) return [];
  const ref = parseExternalId(id);
  if (!ref) return [];
  const maps = externalMaps()[ref.kind];
  if (!maps) return [];

  if (type === "movie") {
    if (ref.season != null) return []; // a movie id shouldn't carry S/E
    return (maps.movies.get(ref.key) || []).map((m) => ({
      streamPath: m.streamPath,
      container: m.container,
      quality: m.quality,
      subs: m.subs || [],
      label: null,
    }));
  }

  const season = Number(ref.season);
  const episode = Number(ref.episode);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return [];

  const out = [];
  for (const s of maps.series.get(ref.key) || []) {
    const e = (s.episodes || []).find((x) => x.season === season && x.episode === episode);
    if (e) {
      out.push({
        streamPath: e.streamPath,
        container: e.container,
        quality: e.quality,
        subs: e.subs || [],
        label: `S${season}E${episode}`,
      });
    }
  }
  return out;
}

// All playable targets for an id: our own "wbx:" ids resolve to exactly one, a
// bridged external id can resolve to several.
function resolveTargets(type, id) {
  if (isExternalId(id)) return resolveExternalTargets(type, id);
  const t = resolvePlayable(type, id);
  return t ? [t] : [];
}

async function getStreams(type, id) {
  const targets = resolveTargets(type, id).filter((t) => t && t.streamPath);
  if (!targets.length) return [];

  // Attach Basic auth so the player fetches directly from the seedbox, no relay.
  const auth = wb.authHeaderValue();
  const name = settings.get("addonName");
  return targets.map((target) => {
    const stream = {
      url: wb.fileUrl(target.streamPath),
      name,
      title:
        [target.label, target.quality, target.container].filter(Boolean).join(" ") || "Direct",
    };
    if (auth) {
      stream.behaviorHints = { proxyHeaders: { request: { Authorization: auth } } };
    }
    return stream;
  });
}

async function getSubtitles(type, id, extra) {
  void extra;
  // Works for our own ids and for bridged external ids, so a title opened from
  // Cinemeta still gets our sidecar subtitles.
  const target = resolveTargets(type, id).find((t) => t && t.subs && t.subs.length);
  if (!target) return [];

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
  isoDate,
};
