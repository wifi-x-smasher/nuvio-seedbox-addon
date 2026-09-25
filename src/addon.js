"use strict";

const { addonBuilder } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const store = require("./store");

// The builder gets the full catalog superset so it accepts a request for any
// catalog id; index.js serves /manifest.json from manifest.build() (live).
const builder = new addonBuilder(manifest.full);

// How long a client may reuse an answer. The SDK turns these into Cache-Control,
// so a player can redraw a row or reopen a title without asking us at all. The
// server answers in milliseconds, but the round trip costs far more than that
// over the internet, and it is paid repeatedly on a TV, where memory pressure
// drops caches early. The library only changes when a scan runs, and
// stale-while-revalidate means a stale answer is shown instantly while the
// client refreshes in the background, so nothing stays out of date for long.
const HOUR = 60 * 60;
const CACHE = {
  // Rows change only on a rescan.
  catalog: { cacheMaxAge: HOUR, staleRevalidate: 12 * HOUR, staleError: 24 * HOUR },
  // Detail pages are the most expensive to build and the most re-opened.
  meta: { cacheMaxAge: 12 * HOUR, staleRevalidate: 24 * HOUR, staleError: 7 * 24 * HOUR },
  // Shorter: a stale URL here means a failed play, not just stale text.
  stream: { cacheMaxAge: HOUR, staleRevalidate: 6 * HOUR, staleError: 24 * HOUR },
  subtitles: { cacheMaxAge: 12 * HOUR, staleRevalidate: 24 * HOUR, staleError: 7 * 24 * HOUR },
};

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const metas = await store.listCatalog(type, {
    search: extra && extra.search,
    skip: extra && extra.skip,
    catalogId: id,
  });
  return { metas, ...CACHE.catalog };
});

builder.defineMetaHandler(async ({ type, id }) => {
  const meta = await store.getMeta(type, id);
  return { meta: meta || null, ...CACHE.meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
  const streams = await store.getStreams(type, id);
  return { streams, ...CACHE.stream };
});

builder.defineSubtitlesHandler(async ({ type, id, extra }) => {
  const subtitles = await store.getSubtitles(type, id, extra);
  return { subtitles, ...CACHE.subtitles };
});

module.exports = builder.getInterface();
