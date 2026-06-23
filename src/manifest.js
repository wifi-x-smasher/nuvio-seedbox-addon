"use strict";

// Stremio/Nuvio add-on manifest.
// Items use a custom id prefix ("wbx:") so this add-on owns its own metadata
// instead of colliding with Cinemeta/other meta providers.
//
// Series are split into per-language catalogs (K-Drama / C-Drama / J-Drama /
// Thai / Other). Two views of the manifest:
//   - full():    every possible catalog. Given to the SDK builder so it will
//                accept a request for any of them even before the first scan.
//   - build():   what we actually advertise at /manifest.json — the live add-on
//                name plus only the catalogs that currently have content. Served
//                fresh per request (see index.js) so onboarding/new languages
//                show up without a restart.

const store = require("./store");
const settings = require("./settings");

// Known original-language codes -> catalog label, in display order.
const LANG_LABELS = [
  ["ko", "K-Drama"],
  ["zh", "C-Drama"],
  ["ja", "J-Drama"],
  ["th", "Thai"],
];
const KNOWN_LANGS = LANG_LABELS.map(([code]) => code);

const EXTRA = [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }];

function movieCatalog() {
  return { type: "movie", id: "wbx-movies", name: "Movies", extra: EXTRA };
}

// Every catalog this add-on could ever serve (used by the SDK builder so it
// never rejects a valid catalog id, regardless of what's indexed yet).
function allCatalogs() {
  return [
    movieCatalog(),
    ...LANG_LABELS.map(([code, label]) => ({
      type: "series",
      id: `wbx-series-${code}`,
      name: label,
      extra: EXTRA,
    })),
    { type: "series", id: "wbx-series-other", name: "Other Series", extra: EXTRA },
  ];
}

// Only the catalogs that currently have content, so empty rows don't appear.
function presentCatalogs() {
  const series = store.loadIndex().series;
  const cats = [movieCatalog()];
  for (const [code, label] of LANG_LABELS) {
    if (series.some((s) => s.lang === code)) {
      cats.push({ type: "series", id: `wbx-series-${code}`, name: label, extra: EXTRA });
    }
  }
  if (series.some((s) => !KNOWN_LANGS.includes(s.lang))) {
    cats.push({ type: "series", id: "wbx-series-other", name: "Other Series", extra: EXTRA });
  }
  // Fallback so the catalog isn't empty before the first language-aware scan.
  if (cats.length === 1) {
    cats.push({ type: "series", id: "wbx-series-other", name: "Series", extra: EXTRA });
  }
  return cats;
}

function base(catalogs) {
  return {
    id: "community.nuvio.seedbox",
    version: "0.1.0",
    name: settings.get("addonName"),
    description:
      "Self-hosted seedbox library: catalogs, direct streaming, and external subtitles.",
    resources: ["catalog", "meta", "stream", "subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["wbx:"],
    catalogs,
    behaviorHints: { configurable: false },
  };
}

// Static superset for the SDK builder (built once at require-time is fine; the
// catalog list here is fixed and the name isn't used because index.js serves
// /manifest.json itself).
const full = base(allCatalogs());

// Live manifest served to clients.
function build() {
  return base(presentCatalogs());
}

module.exports = { full, build };
