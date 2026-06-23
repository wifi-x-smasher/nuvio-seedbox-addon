"use strict";

const { addonBuilder } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const store = require("./store");

// The builder gets the full catalog superset so it accepts a request for any
// catalog id; index.js serves /manifest.json from manifest.build() (live).
const builder = new addonBuilder(manifest.full);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const metas = await store.listCatalog(type, {
    search: extra && extra.search,
    skip: extra && extra.skip,
    catalogId: id,
  });
  return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
  const meta = await store.getMeta(type, id);
  return { meta: meta || null };
});

builder.defineStreamHandler(async ({ type, id }) => {
  const streams = await store.getStreams(type, id);
  return { streams };
});

builder.defineSubtitlesHandler(async ({ type, id, extra }) => {
  const subtitles = await store.getSubtitles(type, id, extra);
  return { subtitles };
});

module.exports = builder.getInterface();
