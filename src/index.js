"use strict";

// Custom HTTP(S) server: we mount stremio-addon-sdk's router (manifest, catalog,
// meta, stream, subtitles) and add our own /sub/<token> subtitle relay route
// in front of it. serveHTTP can't host the relay, so we use getRouter instead.
//
// Access control: when ADDON_SECRET is set, every request must be under the
// "/<secret>/" path (so a public URL can't be guessed/scraped — this matters
// because stream responses carry the Whatbox credentials). Requests without the
// secret get 404. With no secret set, the add-on is open (dev only).
//
// TLS: if TLS_CERT and TLS_KEY are set, serve HTTPS (with periodic cert reload
// so auto-renewed certs are picked up without downtime); otherwise plain HTTP.
//
// Auto re-index: runs a library scan once at startup (if the index is empty)
// and then on a recurring interval, so new downloads appear automatically.

const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { getRouter } = require("stremio-addon-sdk");
const config = require("./config");
const settings = require("./settings");
const addonInterface = require("./addon");
const relay = require("./subs/relay");
const admin = require("./admin");

const router = getRouter(addonInterface);
const SECRET = config.addon.secret;

// Strip the secret path prefix; returns the inner path, or null if it doesn't
// match (reject). When no secret is configured, pass everything through.
function stripSecret(url) {
  if (!SECRET) return url;
  const prefix = `/${SECRET}`;
  if (url === prefix) return "/";
  if (url.startsWith(`${prefix}/`)) return url.slice(prefix.length);
  return null;
}

function handleRequest(req, res) {
  // Public, unauthenticated health check (for an uptime probe / keep-alive).
  if (req.url === "/healthz") {
    res.statusCode = 200;
    res.end("ok");
    return;
  }

  const inner = stripSecret(req.url);
  if (inner === null) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  req.url = inner;

  if (admin.matches(req.url)) {
    admin.handle(req, res, { runScan, scanning: () => scanning });
    return;
  }

  if (relay.matches(req.url)) {
    relay.handle(req, res);
    return;
  }
  router(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
}

// Build an HTTPS server when TLS_CERT/TLS_KEY are provided, else HTTP.
function createServer() {
  const certPath = process.env.TLS_CERT;
  const keyPath = process.env.TLS_KEY;
  if (certPath && keyPath) {
    try {
      const server = https.createServer(
        { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
        handleRequest,
      );
      // Reload the cert periodically so renewals are picked up without a restart.
      setInterval(() => {
        try {
          server.setSecureContext({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) });
        } catch (err) {
          console.warn(`[tls] cert reload failed: ${err.message}`);
        }
      }, 12 * 60 * 60 * 1000);
      console.log("[tls] HTTPS enabled.");
      return server;
    } catch (err) {
      console.warn(`[tls] cert/key unreadable, falling back to HTTP: ${err.message}`);
    }
  }
  return http.createServer(handleRequest);
}

const server = createServer();

// --- Auto re-index scheduler ---------------------------------------------
let scanning = false;
function runScan() {
  if (scanning) {
    console.log("[scan] previous scan still running — skipping this tick");
    return;
  }
  scanning = true;
  console.log("[scan] starting library scan…");
  const child = spawn(process.execPath, [path.join(__dirname, "indexer", "scan.js")], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    scanning = false;
    console.log(`[scan] finished (exit ${code}).`);
  });
  child.on("error", (err) => {
    scanning = false;
    console.warn(`[scan] failed to start: ${err.message}`);
  });
}

function indexIsEmpty() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(config.dataDir, "index.json"), "utf8"));
    return !((idx.movies && idx.movies.length) || (idx.series && idx.series.length));
  } catch {
    return true;
  }
}

server.listen(config.addon.port, () => {
  console.log(`Whatbox add-on running on port ${config.addon.port}.`);
  console.log(`Manifest: ${config.addon.publicUrl}/manifest.json`);
  if (!SECRET) {
    console.log("WARNING: ADDON_SECRET not set — the add-on is open. Set it before deploying.");
  }

  if (indexIsEmpty()) {
    console.log("[scan] index is empty — running initial scan.");
    runScan();
  }
  // Self-rescheduling so the interval (editable in admin) is re-read each cycle.
  function scheduleNext() {
    const mins = Number(settings.get("scanIntervalMinutes")) || 720;
    setTimeout(() => {
      runScan();
      scheduleNext();
    }, mins * 60 * 1000);
  }
  scheduleNext();
  console.log(`[scan] auto re-index every ${settings.get("scanIntervalMinutes")} min (live-configurable).`);
});
