"use strict";

// Stremio/Nuvio add-on manifest.
// Items use a custom id prefix ("wbx:") so this add-on owns its own metadata
// instead of colliding with Cinemeta/other meta providers.
//
// Series are split into per-language catalogs (K-Drama / C-Drama / J-Drama /
// Thai / Other). Catalogs are generated from the languages actually present in
// the index, so empty rows don't appear. (Built once at startup; restart after
// a re-scan to pick up newly added languages.)

const store = require("./store");
const config = require("./config");

// Known original-language codes -> catalog label, in display order.
const LANG_LABELS = [
  ["ko", "K-Drama"],
  ["zh", "C-Drama"],
  ["ja", "J-Drama"],
  ["th", "Thai"],
];
const KNOWN_LANGS = LANG_LABELS.map(([code]) => code);

const EXTRA = [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }];

function seriesCatalogs() {
  const series = store.loadIndex().series;
  const cats = [];
  for (const [code, label] of LANG_LABELS) {
    if (series.some((s) => s.lang === code)) {
      cats.push({ type: "series", id: `wbx-series-${code}`, name: label, extra: EXTRA });
    }
  }
  // Anything not in a known language bucket (incl. unmatched/null).
  if (series.some((s) => !KNOWN_LANGS.includes(s.lang))) {
    cats.push({ type: "series", id: "wbx-series-other", name: "Other Series", extra: EXTRA });
  }
  // Fallback so the catalog isn't empty before the first language-aware scan.
  if (cats.length === 0) {
    cats.push({ type: "series", id: "wbx-series-other", name: "Series", extra: EXTRA });
  }
  return cats;
}

const manifest = {
  id: "community.nuvio.seedbox",
  version: "0.1.0",
  name: config.addon.name,
  description:
    "Self-hosted seedbox library: catalogs, direct streaming, and external subtitles.",
  resources: ["catalog", "meta", "stream", "subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["wbx:"],
  catalogs: [
    { type: "movie", id: "wbx-movies", name: "Movies", extra: EXTRA },
    ...seriesCatalogs(),
  ],
  behaviorHints: {
    configurable: false,
  },
};

module.exports = manifest;
