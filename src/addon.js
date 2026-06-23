"use strict";

const { addonBuilder } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const store = require("./store");

const builder = new addonBuilder(manifest);

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
