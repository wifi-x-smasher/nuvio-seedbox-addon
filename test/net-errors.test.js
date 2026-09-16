"use strict";

// Connection failures must say WHY. Node's fetch reports every pre-response
// failure as "fetch failed" and hides the reason on err.cause; a user on a
// shared seedbox could not tell a refused connection from a DNS or certificate
// problem. Real sockets on 127.0.0.1 only, so these never touch the internet.

const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wbx-net-"));
process.env.DATA_DIR = DATA_DIR;

const test = require("node:test");
const assert = require("node:assert/strict");
const { describeFetchError } = require("../src/util/net");

// A port with nothing listening on it (bind, read the port, close).
function closedPort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// A server that accepts connections and never responds.
function silentServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const s = net.createServer((sock) => sockets.add(sock)).listen(0, "127.0.0.1", () => {
      resolve({
        port: s.address().port,
        close: () => {
          for (const sock of sockets) sock.destroy();
          s.close();
        },
      });
    });
  });
}

const failWith = (cause) => Object.assign(new TypeError("fetch failed"), { cause });
const sysErr = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

test("real refused connection is reported as such, with the address", async () => {
  const port = await closedPort();
  const err = await fetch(`http://127.0.0.1:${port}/`).then(() => null, (e) => e);
  assert.ok(err, "fetch should have failed");
  const d = describeFetchError(err);
  assert.equal(d.code, "ECONNREFUSED");
  assert.equal(d.unreachable, true);
  assert.match(d.detail, /^connection refused \(ECONNREFUSED 127\.0\.0\.1:\d+\)$/);
  assert.doesNotMatch(d.detail, /fetch failed/);
});

test("real timeout names the limit", async () => {
  const srv = await silentServer();
  try {
    const err = await fetch(`http://127.0.0.1:${srv.port}/`, {
      signal: AbortSignal.timeout(300),
    }).then(() => null, (e) => e);
    const d = describeFetchError(err, { timeoutMs: 15000 });
    assert.equal(d.code, "TIMEOUT");
    assert.equal(d.unreachable, true);
    assert.equal(d.detail, "no response after 15s (timed out)");
  } finally {
    srv.close();
  }
});

test("DNS failure is explained and not treated as unreachable", () => {
  const d = describeFetchError(failWith(sysErr("ENOTFOUND", { hostname: "nope.invalid" })));
  assert.equal(d.detail, "hostname not found (DNS lookup failed) (ENOTFOUND)");
  assert.equal(d.unreachable, false);
});

test("certificate errors are named", () => {
  const d = describeFetchError(failWith(sysErr("UNABLE_TO_VERIFY_LEAF_SIGNATURE")));
  assert.equal(d.reason, "HTTPS certificate problem");
  assert.match(d.detail, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
});

test("IPv4/IPv6 fallback lists every address tried", () => {
  // Node 20+ shape when a hostname resolves to both families and both fail.
  const agg = Object.assign(new AggregateError([
    sysErr("ECONNREFUSED", { address: "::1", port: 443 }),
    sysErr("ECONNREFUSED", { address: "127.0.0.1", port: 443 }),
  ]), { code: "ECONNREFUSED" });
  const d = describeFetchError(failWith(agg));
  assert.equal(d.detail, "connection refused (ECONNREFUSED ::1:443, 127.0.0.1:443)");
});

test("an unknown error without a code still beats 'fetch failed'", () => {
  const d = describeFetchError(failWith(new Error("bad port")));
  assert.equal(d.detail, "bad port");
});

test("setup check reports the real reason plus the same-machine hint", async () => {
  const port = await closedPort();
  // onboard.testConnection is internal; exercise it through the module's handler
  // shape by requiring it fresh and calling the exported flow via a fake request.
  const onboard = require("../src/onboard");
  const res = await callSetupTest(onboard, {
    baseUrl: `http://127.0.0.1:${port}/`,
    user: "u",
    pass: "p",
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /Could not reach http:\/\/127\.0\.0\.1:\d+\/: connection refused \(ECONNREFUSED/);
  assert.match(res.error, /same seedbox/);
  assert.doesNotMatch(res.error, /fetch failed/);
});

test("scan directory listing throws the real reason", async () => {
  const port = await closedPort();
  // Via settings.json, which is read live. (config snapshots env vars when it is
  // first required, which an earlier test in this file has already done.)
  fs.writeFileSync(
    path.join(DATA_DIR, "settings.json"),
    JSON.stringify({ seedboxBaseUrl: `http://127.0.0.1:${port}/`, seedboxUser: "u", seedboxPass: "p" }),
  );
  const client = require("../src/seedbox/client");
  await assert.rejects(client.listDir("Movies/"), (err) => {
    assert.match(err.message, /Could not reach .*Movies\/: connection refused \(ECONNREFUSED/);
    return true;
  });
});

// POST /setup/test through onboard.handle with minimal req/res stand-ins.
function callSetupTest(onboard, body) {
  const { EventEmitter } = require("events");
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.url = "/setup/test";
    req.method = "POST";
    req.headers = {};
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve(JSON.parse(payload));
      },
    };
    onboard.handle(req, res, {});
    process.nextTick(() => {
      req.emit("data", JSON.stringify(body));
      req.emit("end");
    });
  });
}
