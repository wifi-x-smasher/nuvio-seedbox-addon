"use strict";

// Gzip our text responses (JSON, HTML, subtitles). A detail page is ~9KB of
// JSON that compresses to roughly a fifth of that, which matters on a TV over
// Wi-Fi far more than it does on a phone next to the router.
//
// Implemented as a wrapper around res.write/res.end rather than a framework
// middleware, because responses come from three places (the SDK router, the
// subtitle relay, the admin page) and all of them just call res.end(body).
//
// Deliberately conservative: only when the client asked for gzip, only for text
// content types, only above a size where compression pays for itself, and never
// once headers are already on the wire. Anything else passes straight through.

const zlib = require("zlib");

const MIN_BYTES = 1024; // below this, the gzip header costs more than it saves
const TEXTY = /^(application\/(json|javascript|xml)|text\/|application\/x-subrip)/i;

function enableGzip(req, res) {
  if (!/\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""))) return;
  if (req.method === "HEAD") return;

  const chunks = [];
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  const push = (chunk, enc) => {
    if (!chunk) return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === "string" ? enc : "utf8"));
  };

  res.write = (chunk, enc, cb) => {
    push(chunk, enc);
    const done = typeof enc === "function" ? enc : cb;
    if (done) done();
    return true;
  };

  res.end = (chunk, enc, cb) => {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = undefined;
    } else if (typeof enc === "function") {
      cb = enc;
      enc = undefined;
    }
    push(chunk, enc);
    const body = Buffer.concat(chunks);

    // Restore the real methods before responding, so we never double-wrap.
    res.write = write;
    res.end = end;

    const type = String(res.getHeader("Content-Type") || "");
    const worthIt =
      !res.headersSent &&
      !res.getHeader("Content-Encoding") &&
      TEXTY.test(type) &&
      body.length >= MIN_BYTES;

    if (!worthIt) {
      if (body.length) write(body);
      return end(cb);
    }

    zlib.gzip(body, (err, gz) => {
      if (err || gz.length >= body.length) {
        if (body.length) write(body);
        return end(cb);
      }
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(gz.length));
      res.setHeader("Vary", "Accept-Encoding");
      write(gz);
      end(cb);
    });
    return res;
  };
}

module.exports = { enableGzip };
