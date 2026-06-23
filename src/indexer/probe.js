"use strict";

// Quick connectivity check: lists the top-level Movies/ and TV Shows/ folders
// over the Whatbox HTTP auto-index. Run with: npm run probe
//
// This verifies the base URL, Basic auth, and HTML parsing all work before we
// build the full scanner on top.

const wb = require("../whatbox/client");

async function listTop(label, humanPath) {
  console.log(`\n== ${label} (${humanPath}) ==`);
  const entries = await wb.listDir(wb.encodePath(humanPath));
  const dirs = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir);
  console.log(`${entries.length} entries (${dirs.length} folders, ${files.length} files)`);
  entries.slice(0, 15).forEach((e) => {
    console.log(`${e.isDir ? "[D]" : "   "} ${e.name}`);
  });
  if (entries.length > 15) console.log(`... and ${entries.length - 15} more`);
}

async function main() {
  console.log(`Base: ${wb.baseUrl()}`);
  await listTop("Movies", "Movies/");
  await listTop("TV Shows", "TV Shows/");

  // Drill one level into the first TV folder to confirm episode + .srt listing.
  const tv = await wb.listDir(wb.encodePath("TV Shows/"));
  const firstShow = tv.find((e) => e.isDir);
  if (firstShow) {
    console.log(`\n== Inside first TV folder: ${firstShow.name} ==`);
    const inner = await wb.listDir(firstShow.path);
    inner.slice(0, 20).forEach((e) => {
      console.log(`${e.isDir ? "[D]" : "   "} ${e.name}`);
    });
  }
}

main().catch((err) => {
  console.error("\nProbe failed:", err.message);
  process.exit(1);
});
