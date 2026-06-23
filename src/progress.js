"use strict";

// Tiny shared channel for live scan progress. The scanner (a child process)
// writes scan-progress.json under DATA_DIR; the admin server reads it and shows
// a progress bar. Best-effort — any failure is silently ignored.

const fs = require("fs");
const path = require("path");
const config = require("./config");

const FILE = path.join(config.dataDir, "scan-progress.json");

function write(obj) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ ...obj, updatedAt: new Date().toISOString() }));
  } catch {
    /* best-effort */
  }
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return null;
  }
}

function clear() {
  try {
    fs.unlinkSync(FILE);
  } catch {
    /* nothing to clear */
  }
}

module.exports = { write, read, clear, FILE };
