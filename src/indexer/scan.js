"use strict";

// Scanner: walk the configured movie/series folders over the seedbox auto-index, parse
// filenames, match against TMDB (best effort), collect sidecar subtitles, and
// write the index. Unmatched titles are still included with their parsed name
// so they stay playable.
//
// Run with: npm run scan            (movies + series)
//           npm run scan -- movies  (movies only)
//           npm run scan -- series  (series only)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const settings = require("../settings");
const wb = require("../seedbox/client");
const media = require("../util/media");
const {
  parseName,
  subtitleLang,
  parseFolderTitle,
  parseEpisode,
  normalizeTitle,
  looksLikeAnime,
  inferOriginLang,
} = require("./parse");
const tmdb = require("../metadata/tmdb");
const gemini = require("../metadata/gemini");
const betterposters = require("../metadata/betterposters");
const store = require("../store");
const overrides = require("../overrides").load();

const TMDB_DELAY_MS = 150;
const MAX_DEPTH = 2; // how far to recurse into a series folder

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortHash = (s) => crypto.createHash("md5").update(s).digest("hex").slice(0, 10);

// Persistent match cache: maps a movie's stream path / a series folder name to
// its resolved TMDB match. Successful matches are cached so incremental scans
// skip re-querying TMDB/Gemini for titles already known; only NEW (or still
// unmatched) titles hit the APIs. Delete this file to force a full re-match.
const MATCH_CACHE_FILE = path.join(config.dataDir, "match-cache.json");
function loadMatchCache() {
  try {
    const c = JSON.parse(fs.readFileSync(MATCH_CACHE_FILE, "utf8"));
    return { movies: c.movies || {}, series: c.series || {} };
  } catch {
    return { movies: {}, series: {} };
  }
}
const matchCache = loadMatchCache();
function saveMatchCache() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(MATCH_CACHE_FILE, JSON.stringify(matchCache, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
let cacheStats = { hit: 0, miss: 0 };

// Sidecar subtitle files that matched no video ("unpicked"). Surfaced in admin.
const orphanSubs = [];
// Series folders skipped entirely (no video files / read error). Surfaced in admin.
const skippedFolders = [];

function toSubEntry(s, videoBase) {
  return {
    path: s.path,
    lang: subtitleLang(media.stripExt(s.name), videoBase),
    format: media.ext(s.name).slice(1),
  };
}

// A sub's base name matches the video's when it equals it or extends it after a
// separator. We accept ".", " ", "-", "_" and "(" so suffixes like ".en",
// "-NF" or " (Youku Sub)" still attach (e.g. specials with a "(Youku Sub)" tag).
function subBaseMatches(subBase, videoBase) {
  if (subBase === videoBase) return true;
  if (!subBase.startsWith(videoBase)) return false;
  const sep = subBase.charAt(videoBase.length);
  return sep === "." || sep === " " || sep === "-" || sep === "_" || sep === "(";
}

// Does a subtitle attach to ANY video here? byEpisode: also try SxxExx matching
// (for series). Mirrors the matchSubsFor/subsForEpisode logic; used to find
// "unpicked" subtitle files.
function subMatchesAnyVideo(sub, videos, byEpisode) {
  if (byEpisode) {
    const se = parseEpisode(sub.name);
    if (se.episode != null) {
      const epMatch = videos.some((v) => {
        const ve = parseEpisode(v.name);
        if (ve.episode !== se.episode) return false;
        if (se.season != null && ve.season != null) return se.season === ve.season;
        return true;
      });
      if (epMatch) return true;
    }
  }
  const b = media.stripExt(sub.name);
  return videos.some((v) => subBaseMatches(b, media.stripExt(v.name)));
}

// Record subtitle files in a folder that match none of its videos.
function collectOrphanSubs(videos, subs, byEpisode) {
  for (const s of subs) {
    if (!subMatchesAnyVideo(s, videos, byEpisode)) {
      orphanSubs.push({ name: s.name, path: s.path });
    }
  }
}

// Sidecar subtitles whose base name matches (or extends) a video's base name.
// Used for movies (no episode number to key on).
function matchSubsFor(videoBase, subs) {
  return subs
    .filter((s) => subBaseMatches(media.stripExt(s.name), videoBase))
    .map((s) => toSubEntry(s, videoBase));
}

// Subtitles for a specific episode. Matches by the SxxExx parsed from the sub's
// OWN filename (robust to different release groups/codecs/prefixes, e.g. video
// "...H.265-NAKSU" vs sub "...H265-NAKU-NF", or "后浪.Gen.Z..." vs "qi.Gen.Z..."),
// and falls back to base-name matching when the sub has no episode number.
function subsForEpisode(season, episode, videoBase, subs) {
  return subs
    .filter((s) => {
      const se = parseEpisode(s.name);
      if (se.episode != null) {
        const subSeason = se.season != null ? se.season : season;
        return subSeason === season && se.episode === episode;
      }
      return subBaseMatches(media.stripExt(s.name), videoBase);
    })
    .map((s) => toSubEntry(s, videoBase));
}

// Build movie records from one directory's entries (videos + sidecar subs).
async function collectMovies(entries, seenIds) {
  const videos = entries.filter((e) => !e.isDir && media.isVideo(e.name));
  const subs = entries.filter((e) => !e.isDir && media.isSubtitle(e.name));
  collectOrphanSubs(videos, subs, false);
  const out = [];

  for (const video of videos) {
    const info = parseName(video.name);
    if (info.isSeries) continue; // an episode that landed under Movies; skip

    const hints = { anime: looksLikeAnime(video.name), lang: inferOriginLang(video.name) };
    let match = null;
    let via = "";

    // 1) Manual override (keyed by exact video filename).
    const ov = overrides.movies[video.name];
    if (ov) {
      try {
        if (ov.tmdbId) match = await tmdb.movieById(ov.tmdbId);
        else if (ov.title) match = await tmdb.matchMovie(ov.title, ov.year || info.year, hints);
        if (match) via = " (override)";
      } catch (err) {
        console.warn(`  Override lookup failed for "${video.name}": ${err.message}`);
      }
    }

    // 2) Reuse a cached match (incremental scans skip re-querying known titles).
    if (!match && !ov && matchCache.movies[video.path]) {
      match = matchCache.movies[video.path];
      via = " (cached)";
      cacheStats.hit++;
    }

    // 3) Scored TMDB match on the parsed filename.
    if (!match && !ov) {
      cacheStats.miss++;
      try {
        match = await tmdb.matchMovie(info.title, info.year, hints);
      } catch (err) {
        console.warn(`  TMDB lookup failed for "${info.title}": ${err.message}`);
      }
    }

    // 4) Gemini fallback: identify the canonical English title, then re-query.
    if (!match && gemini.enabled()) {
      const g = await gemini.identify(video.name, "movie");
      await sleep(TMDB_DELAY_MS);
      if (g && g.title) {
        try {
          match = await tmdb.matchMovie(g.title, g.year || info.year, {
            anime: hints.anime,
            lang: g.lang || hints.lang,
          });
          if (match) via = ` (gemini: "${g.title}")`;
        } catch (err) {
          console.warn(`  Gemini re-query failed for "${g.title}": ${err.message}`);
        }
      }
    }

    // Cache freshly resolved matches (not overrides/cache hits).
    if (match && via !== " (override)" && via !== " (cached)") {
      matchCache.movies[video.path] = match;
    }

    const videoBase = media.stripExt(video.name);
    const matchedSubs = matchSubsFor(videoBase, subs);

    const id = "wbx:movie:" + (match ? `t${match.tmdbId}` : `f${shortHash(video.path)}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    out.push({
      id,
      type: "movie",
      name: match?.name || info.title,
      year: match?.year || (info.year ? String(info.year) : null),
      imdbId: match?.imdbId || null,
      bpOk: match?.imdbId ? await betterposters.available(match.imdbId) : false,
      poster: match?.poster || null,
      background: match?.background || null,
      description: match?.description || "",
      genres: match?.genres || [],
      quality: info.resolution || null,
      container: media.ext(video.name).slice(1),
      streamPath: video.path,
      file: video.name, // override key for the admin "unmatched fixer"
      subs: matchedSubs,
      matched: Boolean(match),
    });

    console.log(
      `  ${match ? "[match]" : "[raw]  "} ${info.title}${info.year ? ` (${info.year})` : ""}` +
        `${match ? ` -> ${match.name}${via}` : " (no TMDB hit)"}` +
        `${matchedSubs.length ? ` [${matchedSubs.length} sub]` : ""}`,
    );
    if (match && via !== " (cached)" && via !== " (override)") await sleep(TMDB_DELAY_MS);
  }

  return out;
}

function configuredDirs(key) {
  return settings
    .get(key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function scanMovies() {
  const seenIds = new Set();
  const movies = [];

  for (const dirName of configuredDirs("movieDirs")) {
    let top;
    try {
      top = await wb.listDir(wb.encodePath(dirName + "/"));
    } catch (err) {
      console.warn(`  ! failed to read movies folder "${dirName}": ${err.message}`);
      continue;
    }
    // Flat movie files directly under the folder.
    movies.push(...(await collectMovies(top, seenIds)));
    // One level into movie subfolders (e.g. The.Servant.2010.../)
    for (const dir of top.filter((e) => e.isDir)) {
      console.log(`> ${dir.name}/`);
      const inner = await wb.listDir(dir.path);
      movies.push(...(await collectMovies(inner, seenIds)));
    }
  }

  return movies;
}

// Recursively gather episodes from a series folder (and nested season folders).
async function collectEpisodes(dir, folderInfo, out, depth) {
  const entries = await wb.listDir(dir.path);
  const videos = entries.filter((e) => !e.isDir && media.isVideo(e.name));
  const subs = entries.filter((e) => !e.isDir && media.isSubtitle(e.name));
  collectOrphanSubs(videos, subs, true);

  const specials = [];
  for (const video of videos) {
    const ep = parseEpisode(video.name);
    if (ep.episode == null) {
      specials.push(video); // no episode number -> treat as a Season 0 special
      continue;
    }
    const season = ep.season != null ? ep.season : folderInfo.season != null ? folderInfo.season : 1;

    const videoBase = media.stripExt(video.name);
    out.push({
      season,
      episode: ep.episode,
      title: `Episode ${ep.episode}`,
      streamPath: video.path,
      container: media.ext(video.name).slice(1),
      quality: parseName(video.name).resolution || null,
      subs: subsForEpisode(season, ep.episode, videoBase, subs),
    });
  }

  // Episode-less videos (e.g. "...Special...") -> Season 0 (Stremio's Specials),
  // numbered sequentially so they are playable and can carry their sidecar subs.
  specials.sort((a, b) => a.name.localeCompare(b.name));
  specials.forEach((video, i) => {
    const videoBase = media.stripExt(video.name);
    out.push({
      season: 0,
      episode: i + 1,
      title: `Special ${i + 1}`,
      streamPath: video.path,
      container: media.ext(video.name).slice(1),
      quality: parseName(video.name).resolution || null,
      subs: subsForEpisode(0, i + 1, videoBase, subs),
    });
  });

  if (depth < MAX_DEPTH) {
    for (const sub of entries.filter((e) => e.isDir)) {
      await collectEpisodes(sub, folderInfo, out, depth + 1);
    }
  }
}

async function scanSeries() {
  const folders = [];
  for (const dirName of configuredDirs("seriesDirs")) {
    try {
      const top = await wb.listDir(wb.encodePath(dirName + "/"));
      folders.push(...top.filter((e) => e.isDir));
    } catch (err) {
      console.warn(`  ! failed to read series folder "${dirName}": ${err.message}`);
    }
  }
  const byKey = new Map(); // grouping key -> series record (merges split seasons)

  for (const dir of folders) {
    const folderInfo = parseFolderTitle(dir.name);
    const episodes = [];
    try {
      await collectEpisodes(dir, folderInfo, episodes, 0);
    } catch (err) {
      console.warn(`  ! failed to read ${dir.name}: ${err.message}`);
      skippedFolders.push({ name: dir.name, reason: "read error" });
      continue;
    }
    if (episodes.length === 0) {
      console.log(`  [skip] ${dir.name} (no episodes found)`);
      skippedFolders.push({ name: dir.name, reason: "no video files" });
      continue;
    }

    const hints = { anime: looksLikeAnime(dir.name), lang: inferOriginLang(dir.name) };
    let match = null;
    let via = "";

    // 1) Manual override (highest priority).
    const ov = overrides.series[dir.name];
    if (ov) {
      try {
        if (ov.tmdbId) match = await tmdb.seriesById(ov.tmdbId);
        else if (ov.title) match = await tmdb.matchSeries(ov.title, ov.year || folderInfo.year, hints);
        if (match) via = " (override)";
      } catch (err) {
        console.warn(`  Override lookup failed for "${dir.name}": ${err.message}`);
      }
    }

    // 2) Reuse a cached match (incremental scans skip re-querying known shows).
    if (!match && !ov && matchCache.series[dir.name]) {
      match = matchCache.series[dir.name];
      via = " (cached)";
      cacheStats.hit++;
    }

    // 3) Scored TMDB match on the parsed folder title.
    if (!match && !ov) {
      cacheStats.miss++;
      try {
        match = await tmdb.matchSeries(folderInfo.title, folderInfo.year, hints);
      } catch (err) {
        console.warn(`  TMDB lookup failed for "${folderInfo.title}": ${err.message}`);
      }
    }

    // 4) Gemini fallback: identify the canonical English title, then re-query.
    if (!match && gemini.enabled()) {
      const g = await gemini.identify(dir.name);
      await sleep(TMDB_DELAY_MS); // be gentle with Gemini's rate limit
      if (g && g.title) {
        try {
          match = await tmdb.matchSeries(g.title, g.year || folderInfo.year, {
            anime: hints.anime,
            lang: g.lang || hints.lang,
          });
          if (match) via = ` (gemini: "${g.title}")`;
        } catch (err) {
          console.warn(`  Gemini re-query failed for "${g.title}": ${err.message}`);
        }
      }
    }

    // Cache freshly resolved matches (not overrides/cache hits).
    if (match && via !== " (override)" && via !== " (cached)") {
      matchCache.series[dir.name] = match;
    }

    const key = match ? `t${match.tmdbId}` : `f${shortHash(normalizeTitle(folderInfo.title))}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        id: "wbx:series:" + key,
        type: "series",
        name: match?.name || folderInfo.title,
        year: match?.year || (folderInfo.year ? String(folderInfo.year) : null),
        poster: match?.poster || null,
        background: match?.background || null,
        description: match?.description || "",
        genres: match?.genres || [],
        imdbId: match?.imdbId || null,
        lang: match?.lang || null,
        bpOk: match?.imdbId ? await betterposters.available(match.imdbId) : false,
        folders: [], // source folder name(s) — override keys for the admin fixer
        episodes: [],
        matched: Boolean(match),
      };
      byKey.set(key, rec);
    }
    if (!rec.folders.includes(dir.name)) rec.folders.push(dir.name);

    // Merge episodes, de-duping by season+episode (first folder wins).
    let added = 0;
    for (const ep of episodes) {
      if (!rec.episodes.some((e) => e.season === ep.season && e.episode === ep.episode)) {
        rec.episodes.push(ep);
        added++;
      }
    }

    console.log(
      `  ${match ? "[match]" : "[raw]  "} ${folderInfo.title}` +
        `${match ? ` -> ${match.name}${via}` : " (no TMDB hit)"} (+${added} eps)`,
    );
    if (match && via !== " (cached)" && via !== " (override)") await sleep(TMDB_DELAY_MS);
  }

  const series = [...byKey.values()];
  for (const rec of series) {
    rec.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return series;
}

async function main() {
  const arg = (process.argv[2] || "all").toLowerCase();
  const doMovies = arg === "all" || arg === "movies";
  const doSeries = arg === "all" || arg === "series";

  const index = store.loadIndex();

  if (doMovies) {
    console.log("Scanning Movies/ ...");
    const movies = await scanMovies();
    index.movies = movies;
    const matched = movies.filter((m) => m.matched).length;
    console.log(
      `Movies: ${movies.length} indexed (${matched} matched, ${movies.length - matched} raw).`,
    );
  }

  if (doSeries) {
    console.log("\nScanning TV Shows/ ...");
    const series = await scanSeries();
    index.series = series;
    const matched = series.filter((s) => s.matched).length;
    const eps = series.reduce((n, s) => n + s.episodes.length, 0);
    console.log(
      `Series: ${series.length} shows (${matched} matched, ${
        series.length - matched
      } raw), ${eps} episodes.`,
    );
  }

  index.orphanSubs = orphanSubs;
  if (doSeries) index.skippedFolders = skippedFolders;
  store.saveIndex(index);
  saveMatchCache();
  console.log(
    `\nIndex written. Match cache: ${cacheStats.hit} reused, ${cacheStats.miss} freshly matched.` +
      ` Unpicked subs: ${orphanSubs.length}. Skipped folders: ${skippedFolders.length}.`,
  );
}

main().catch((err) => {
  console.error("\nScan failed:", err.message);
  process.exit(1);
});
