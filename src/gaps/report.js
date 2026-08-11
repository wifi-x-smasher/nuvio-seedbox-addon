"use strict";

// Library gap report: for every matched series, which AIRED episodes TMDB knows
// about that we don't have on disk. Answers "what's incomplete in my library?".
//
// Run standalone (spawned by index.js / the admin button):
//   node src/gaps/report.js
//
// Why its own TMDB fetch instead of reusing meta-cache: enrich.js only pulls the
// seasons we already hold files for, so a season we have NOTHING from would be
// invisible. We take the season list from tvFull() and check every season.
//
// Two rules keep the report honest rather than noisy:
//   - only episodes whose air_date has PASSED count as missing (otherwise every
//     ongoing show reports its whole future season as a gap);
//   - season 0 (specials) is excluded unless explicitly enabled — TMDB's
//     specials numbering is wildly inconsistent across shows.

const fs = require("fs");
const path = require("path");
const config = require("../config");
const settings = require("../settings");
const store = require("../store");
const tmdb = require("../metadata/tmdb");

const REPORT_FILE = path.join(config.dataDir, "gaps.json");
const CACHE_FILE = path.join(config.dataDir, "gap-cache.json");
const TMDB_DELAY_MS = 150;

// Ended shows won't grow new episodes, so their season data can be cached for a
// long time; a running show needs re-checking about daily.
const TTL_ENDED_MS = 30 * 24 * 60 * 60 * 1000;
const TTL_RUNNING_MS = 24 * 60 * 60 * 1000;
const ENDED = new Set(["Ended", "Canceled", "Cancelled"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayIso = () => new Date().toISOString().slice(0, 10);

function tmdbIdOf(id) {
  const m = String(id || "").match(/^wbx:series:t(\d+)$/);
  return m ? Number(m[1]) : null;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function includeSpecials() {
  const v = settings.get("gapsIncludeSpecials");
  return v === true || v === "true" || v === "on" || v === "1" || v === "yes";
}

// Fetch (or reuse) the full season/episode map for a show:
//   { status, seasons: { "<season>": [{ e: <episode>, d: <air_date|null> }] } }
async function showData(tmdbId, cache) {
  const hit = cache[tmdbId];
  if (hit && hit.fetchedAt) {
    const age = Date.now() - new Date(hit.fetchedAt).getTime();
    const ttl = ENDED.has(hit.status) ? TTL_ENDED_MS : TTL_RUNNING_MS;
    if (age < ttl) return hit;
  }

  const detail = await tmdb.tvFull(tmdbId);
  if (!detail) return null;
  await sleep(TMDB_DELAY_MS);

  const seasons = {};
  for (const s of detail.seasons || []) {
    const num = Number(s.season_number);
    if (!Number.isFinite(num)) continue;
    if (num === 0 && !includeSpecials()) continue;
    const sd = await tmdb.tvSeason(tmdbId, num).catch(() => null);
    await sleep(TMDB_DELAY_MS);
    if (!sd || !Array.isArray(sd.episodes)) continue;
    seasons[num] = sd.episodes.map((ep) => ({
      e: Number(ep.episode_number),
      d: ep.air_date || null,
    }));
  }

  const entry = { fetchedAt: new Date().toISOString(), status: detail.status || null, seasons };
  cache[tmdbId] = entry;
  return entry;
}

// Compare TMDB's episode list against what's on disk for one series.
function analyse(series, data) {
  const today = todayIso();
  const have = new Set(
    (series.episodes || []).map((ep) => `${Number(ep.season)}:${Number(ep.episode)}`),
  );

  const seasons = [];
  let missingCount = 0;
  let airedTotal = 0;

  for (const key of Object.keys(data.seasons).sort((a, b) => Number(a) - Number(b))) {
    const num = Number(key);
    if (num === 0 && !includeSpecials()) continue;
    // Only episodes that have actually aired can be "missing".
    const aired = data.seasons[key].filter((ep) => ep.d && ep.d <= today);
    if (!aired.length) continue;
    const missing = aired.filter((ep) => !have.has(`${num}:${ep.e}`)).map((ep) => ep.e);
    airedTotal += aired.length;
    missingCount += missing.length;
    seasons.push({ season: num, aired: aired.length, have: aired.length - missing.length, missing });
  }

  const haveTotal = airedTotal - missingCount;
  // A big shortfall WITHIN a season we clearly hold usually means a WRONG MATCH
  // rather than missing files — e.g. a 16-episode WEB-DL release matched to a
  // 115-episode show. Judged per season on purpose: a wholly missing season is a
  // real gap, and comparing totals would wrongly flag that as a bad match.
  const suspectMismatch = seasons.some((s) => s.have >= 5 && s.aired >= s.have * 3);

  return {
    id: series.id,
    name: series.name,
    tmdbId: tmdbIdOf(series.id),
    status: data.status || null,
    airedTotal,
    haveTotal,
    missingCount,
    suspectMismatch,
    complete: missingCount === 0,
    // Only seasons with something missing are worth listing.
    seasons: seasons.filter((s) => s.missing.length),
  };
}

async function main() {
  const index = store.loadIndex();
  const all = (index.series || []).filter((s) => s.matched && tmdbIdOf(s.id));
  const skipped = (index.series || []).length - all.length;

  console.log(`[gaps] analysing ${all.length} matched series...`);
  const cache = readJson(CACHE_FILE, {});
  const results = [];

  for (const series of all) {
    const tmdbId = tmdbIdOf(series.id);
    try {
      const data = await showData(tmdbId, cache);
      if (!data) continue;
      results.push(analyse(series, data));
    } catch (err) {
      console.warn(`[gaps] ${series.name}: ${err.message}`);
    }
  }

  // Save the cache even on partial runs so a retry is cheap.
  writeAtomic(CACHE_FILE, cache);

  const withGaps = results.filter((r) => !r.complete);
  withGaps.sort((a, b) => b.missingCount - a.missingCount);

  writeAtomic(REPORT_FILE, {
    generatedAt: new Date().toISOString(),
    includeSpecials: includeSpecials(),
    summary: {
      analysed: results.length,
      skippedUnmatched: skipped,
      complete: results.length - withGaps.length,
      withGaps: withGaps.length,
      missingEpisodes: withGaps.reduce((n, r) => n + r.missingCount, 0),
    },
    series: withGaps,
  });

  console.log(
    `[gaps] done: ${results.length - withGaps.length} complete, ${withGaps.length} with gaps, ` +
      `${withGaps.reduce((n, r) => n + r.missingCount, 0)} episodes missing.`,
  );
}

// Only run when executed directly, so the pure helpers stay unit-testable.
if (require.main === module) {
  main().catch((err) => {
    console.error("[gaps] failed:", err.message);
    process.exit(1);
  });
}

module.exports = { analyse, tmdbIdOf, main };
