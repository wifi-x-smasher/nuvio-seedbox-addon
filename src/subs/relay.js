"use strict";

// Subtitle relay. The Stremio/Nuvio subtitles protocol can't carry an auth
// header, so the player cannot fetch protected Whatbox files directly the way
// it does for video streams. Instead we hand the player a short "/sub/<token>"
// URL on this add-on; when the player fetches it, we pull the real file from
// Whatbox (with Basic auth) and return the plain subtitle.
//
// The token is a base64url-encoded Whatbox path (already URL-encoded, relative
// to the library base). The optional ".ext" suffix in the URL is only a format
// hint for the player; the real path/extension lives inside the token.

const wb = require("../whatbox/client");
const media = require("../util/media");
const { assToSrt } = require("./ass");

function encodeToken(encodedRelPath) {
  return Buffer.from(encodedRelPath, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeToken(token) {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function contentTypeFor(ext) {
  switch (ext.toLowerCase()) {
    case ".vtt":
      return "text/vtt; charset=utf-8";
    case ".srt":
      return "application/x-subrip; charset=utf-8";
    default:
      return "text/plain; charset=utf-8"; // .ass/.ssa/.sub
  }
}

// True for any request this relay should handle.
function matches(reqUrl) {
  return reqUrl.startsWith("/sub/");
}

// Handle a /sub/<token>.<ext> request. Returns true if it handled it.
async function handle(req, res) {
  try {
    const pathname = req.url.split("?")[0]; // strip any query
    const file = pathname.slice("/sub/".length); // "<token>.<ext>" or "<token>"
    const dot = file.lastIndexOf(".");
    const token = dot >= 0 ? file.slice(0, dot) : file;
    if (!token) {
      res.statusCode = 400;
      res.end("Bad subtitle token");
      return true;
    }

    const encodedRelPath = decodeToken(token);
    const url = wb.fileUrl(encodedRelPath);
    const upstream = await fetch(url, { headers: wb.authHeaders() });
    if (!upstream.ok) {
      res.statusCode = upstream.status === 401 ? 502 : upstream.status;
      res.end(`Subtitle fetch failed (HTTP ${upstream.status})`);
      return true;
    }

    const srcExt = media.ext(encodedRelPath).toLowerCase();
    let buf = Buffer.from(await upstream.arrayBuffer());
    let contentType = contentTypeFor(srcExt);

    // Convert ASS/SSA to SRT so the subtitle renders on mobile players too.
    if (srcExt === ".ass" || srcExt === ".ssa") {
      buf = Buffer.from(assToSrt(buf.toString("utf8")), "utf8");
      contentType = "application/x-subrip; charset=utf-8";
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(buf);
  } catch (err) {
    res.statusCode = 500;
    res.end(`Subtitle relay error: ${err.message}`);
  }
  return true;
}

module.exports = { encodeToken, decodeToken, matches, handle };
