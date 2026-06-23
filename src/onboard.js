"use strict";

// First-run onboarding. Until the add-on has the minimum config (a seedbox
// base URL + user and an access secret), it is "unconfigured" and every request
// is steered to /setup. The setup page lets the user:
//   - enter their seedbox HTTP index URL + Basic-auth credentials,
//   - test the connection (lists the configured Movies/TV folders) live,
//   - enter a TMDB key (+ optional Gemini/RPDB),
//   - and on save we auto-generate ADDON_SECRET + an admin password and persist
//     everything to settings.json (DATA_DIR), so no .env editing is required.
//
// This page is reachable WITHOUT the secret because on first run there is no
// secret yet (and nothing sensitive is served until configured). Once a secret
// is set, /setup returns 404 — later changes go through the admin settings page.

const crypto = require("crypto");
const settings = require("./settings");
const client = require("./seedbox/client");

function isConfigured() {
  return Boolean(
    settings.get("addonSecret") &&
      settings.get("seedboxBaseUrl") &&
      settings.get("seedboxUser"),
  );
}

function matches(url) {
  const p = url.split("?")[0];
  return p === "/setup" || p === "/setup/" || p === "/setup/test" || p === "/setup/save";
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, obj, code = 200) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function normBase(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.endsWith("/") ? u : `${u}/`;
}

function splitDirs(s, fallback) {
  const list = String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

// Try to reach the seedbox with the given (unsaved) creds and report which of
// the configured media folders are visible.
async function testConnection({ baseUrl, user, pass, movieDirs, seriesDirs }) {
  const base = normBase(baseUrl);
  if (!base) return { ok: false, error: "Enter the seedbox index URL." };
  if (!user) return { ok: false, error: "Enter the seedbox username." };

  const auth = "Basic " + Buffer.from(`${user}:${pass || ""}`).toString("base64");
  let res;
  try {
    res = await fetch(base, { headers: { Authorization: auth } });
  } catch (e) {
    return { ok: false, error: `Could not reach ${base} (${e.message}).` };
  }
  if (res.status === 401) {
    return { ok: false, error: "Authentication failed — check the username/password." };
  }
  if (!res.ok) {
    return { ok: false, error: `Server returned HTTP ${res.status} for ${base}.` };
  }

  const html = await res.text();
  const entries = client.parseIndexHtml(html);
  if (!entries.length) {
    return {
      ok: false,
      error: "Reached the server, but it does not look like a file index (no links found).",
    };
  }

  const names = new Set(entries.filter((e) => e.isDir).map((e) => e.name));
  const want = [
    ...splitDirs(movieDirs, ["Movies"]).map((d) => ({ kind: "Movies", name: d })),
    ...splitDirs(seriesDirs, ["TV Shows"]).map((d) => ({ kind: "Series", name: d })),
  ];
  const found = want.filter((w) => names.has(w.name)).map((w) => `${w.name} (${w.kind})`);
  const missing = want.filter((w) => !names.has(w.name)).map((w) => w.name);

  return {
    ok: true,
    base,
    entryCount: entries.length,
    found,
    missing,
    sample: entries.slice(0, 12).map((e) => e.name + (e.isDir ? "/" : "")),
  };
}

async function handle(req, res, ctx) {
  const url = req.url.split("?")[0];

  // Once configured, the public setup page is closed off.
  if (isConfigured() && (url === "/setup" || url === "/setup/")) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  if ((url === "/setup" || url === "/setup/") && req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderPage());
    return;
  }

  if (url === "/setup/test" && req.method === "POST") {
    const body = await readBody(req);
    return json(res, await testConnection(body));
  }

  if (url === "/setup/save" && req.method === "POST") {
    if (isConfigured()) return json(res, { error: "Already configured." }, 409);
    const body = await readBody(req);

    const test = await testConnection(body);
    if (!test.ok && !body.force) {
      return json(res, { error: test.error, needsForce: true }, 400);
    }

    // Public base URL the player will use; default to whatever host the browser
    // reached us on (best-effort) so links work out of the box.
    const host = req.headers.host || `127.0.0.1:${require("./config").addon.port}`;
    const proto = req.headers["x-forwarded-proto"] || "http";
    const addonBaseUrl = (body.addonBaseUrl && body.addonBaseUrl.trim()) || `${proto}://${host}`;

    const secret = crypto.randomBytes(24).toString("hex");
    // Readable-ish admin password (user may also have supplied one).
    const adminPassword =
      (body.adminPassword && body.adminPassword.trim()) ||
      crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);

    settings.update({
      seedboxBaseUrl: normBase(body.baseUrl),
      seedboxUser: String(body.user || "").trim(),
      seedboxPass: String(body.pass || ""),
      movieDirs: splitDirs(body.movieDirs, ["Movies"]).join(","),
      seriesDirs: splitDirs(body.seriesDirs, ["TV Shows"]).join(","),
      tmdbKey: String(body.tmdbKey || "").trim(),
      geminiKey: String(body.geminiKey || "").trim(),
      rpdbKey: String(body.rpdbKey || "").trim(),
      addonName: (body.addonName && body.addonName.trim()) || "Seedbox Library",
      addonBaseUrl,
      addonSecret: secret,
      adminPassword,
    });

    if (ctx && typeof ctx.runScan === "function") ctx.runScan();

    const publicUrl = settings.publicUrl();
    return json(res, {
      ok: true,
      manifestUrl: `${publicUrl}/manifest.json`,
      adminUrl: `${publicUrl}/admin`,
      adminPassword,
    });
  }

  res.statusCode = 404;
  res.end("Not found");
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
<title>Set up your seedbox add-on</title>
<style>
  :root { --bg:#0c0f0c; --panel:#121612; --line:#1f271f; --fg:#d6e6d6; --dim:#7c8c7c; --accent:#8bff80; --warn:#ffb454; --err:#ff6b6b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:24px; margin:0 0 4px; }
  .sub { color:var(--dim); margin:0 0 24px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:18px; }
  .card h2 { font-size:15px; margin:0 0 14px; color:var(--accent); letter-spacing:.02em; }
  label { display:block; font-size:13px; color:var(--dim); margin:12px 0 4px; }
  input { width:100%; padding:9px 11px; background:#0a0d0a; border:1px solid var(--line); border-radius:8px; color:var(--fg); font:inherit; }
  input:focus { outline:none; border-color:var(--accent); }
  .row { display:flex; gap:12px; }
  .row > div { flex:1; }
  .hint { font-size:12px; color:var(--dim); margin-top:4px; }
  button { font:inherit; font-weight:600; border:none; border-radius:8px; padding:10px 18px; cursor:pointer; }
  .btn { background:#1c241c; color:var(--fg); border:1px solid var(--line); }
  .btn:hover { border-color:var(--accent); }
  .primary { background:var(--accent); color:#06210a; }
  .primary:disabled { opacity:.5; cursor:not-allowed; }
  .bar { display:flex; gap:12px; align-items:center; margin-top:16px; }
  .msg { margin-top:12px; padding:11px 13px; border-radius:8px; font-size:13px; white-space:pre-wrap; display:none; }
  .msg.ok { display:block; background:#0f2310; border:1px solid #1f5a22; color:var(--accent); }
  .msg.err { display:block; background:#2a1212; border:1px solid #5a1f1f; color:var(--err); }
  .msg.warn { display:block; background:#2a2310; border:1px solid #5a4a1f; color:var(--warn); }
  code { background:#0a0d0a; padding:2px 6px; border-radius:5px; border:1px solid var(--line); word-break:break-all; }
  .done a { color:var(--accent); }
  .copy { font-size:12px; padding:5px 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Set up your seedbox add-on</h1>
  <p class="sub">Connect any seedbox that exposes an HTTP file index (an "Index of /…" page) with Basic auth. Nothing is stored until you save.</p>

  <div id="form">
    <div class="card">
      <h2>1 · Seedbox connection</h2>
      <label>Index URL</label>
      <input id="baseUrl" placeholder="https://yourbox.host/private/" autocomplete="off">
      <div class="hint">The "Index of …" page that lists your files. Range/seeking and Basic auth must work.</div>
      <div class="row">
        <div><label>Username</label><input id="user" autocomplete="off"></div>
        <div><label>Password</label><input id="pass" type="password" autocomplete="new-password"></div>
      </div>
      <div class="row">
        <div><label>Movie folder(s)</label><input id="movieDirs" value="Movies"><div class="hint">Comma-separated.</div></div>
        <div><label>Series folder(s)</label><input id="seriesDirs" value="TV Shows"><div class="hint">Comma-separated.</div></div>
      </div>
      <div class="bar">
        <button class="btn" id="testBtn" onclick="test()">Test connection</button>
      </div>
      <div class="msg" id="testMsg"></div>
    </div>

    <div class="card">
      <h2>2 · Metadata</h2>
      <label>TMDB API key</label>
      <input id="tmdbKey" autocomplete="off" placeholder="required for posters, titles, episodes">
      <div class="hint">Free key from themoviedb.org → Settings → API. Required.</div>
      <div class="row">
        <div><label>Gemini API key <span style="color:var(--dim)">(optional)</span></label><input id="geminiKey" autocomplete="off"><div class="hint">Improves matching of foreign titles.</div></div>
        <div><label>RPDB API key <span style="color:var(--dim)">(optional)</span></label><input id="rpdbKey" autocomplete="off"><div class="hint">Rating posters.</div></div>
      </div>
    </div>

    <div class="card">
      <h2>3 · This add-on</h2>
      <label>Display name</label>
      <input id="addonName" value="Seedbox Library">
      <label>Public URL <span style="color:var(--dim)">(optional)</span></label>
      <input id="addonBaseUrl" placeholder="auto-detected from your browser">
      <div class="hint">Where players reach this add-on. Leave blank to use the address you're on now. Set this if you're behind a reverse proxy or custom domain.</div>
      <label>Admin password <span style="color:var(--dim)">(optional)</span></label>
      <input id="adminPassword" type="password" autocomplete="new-password" placeholder="auto-generated if left blank">
      <div class="hint">Protects the admin panel. A strong one is generated for you if blank.</div>
    </div>

    <div class="bar">
      <button class="primary" id="saveBtn" onclick="save()">Save &amp; start</button>
      <span class="hint" id="saveHint"></span>
    </div>
    <div class="msg" id="saveMsg"></div>
  </div>

  <div class="card done" id="done" style="display:none">
    <h2>✓ All set</h2>
    <p>Your add-on is configured and the first library scan has started (it may take a few minutes).</p>
    <p><strong>Install URL</strong> — paste into Nuvio/Stremio → Add-ons → Install via URL:</p>
    <p><code id="manifestUrl"></code> <button class="btn copy" onclick="copy('manifestUrl')">Copy</button></p>
    <p><strong>Admin panel:</strong> <a id="adminUrl" target="_blank"></a></p>
    <p id="pwLine"><strong>Admin login</strong> — username <code>admin</code>, password <code id="adminPw"></code>. Save the password now, it won't be shown again.</p>
  </div>
</div>

<script>
  var $ = function(id){ return document.getElementById(id); };
  function vals(){
    return {
      baseUrl:$('baseUrl').value, user:$('user').value, pass:$('pass').value,
      movieDirs:$('movieDirs').value, seriesDirs:$('seriesDirs').value,
      tmdbKey:$('tmdbKey').value, geminiKey:$('geminiKey').value, rpdbKey:$('rpdbKey').value,
      addonName:$('addonName').value, addonBaseUrl:$('addonBaseUrl').value, adminPassword:$('adminPassword').value
    };
  }
  function show(el, cls, text){ el.className='msg '+cls; el.textContent=text; }
  async function test(){
    var b=$('testBtn'); b.disabled=true; b.textContent='Testing…';
    show($('testMsg'),'warn','Connecting…');
    try{
      var r=await fetch('/setup/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(vals())});
      var d=await r.json();
      if(d.ok){
        var lines=['Connected — '+d.entryCount+' entries at '+d.base];
        if(d.found.length) lines.push('Found: '+d.found.join(', '));
        if(d.missing.length) lines.push('Not found (check the names): '+d.missing.join(', '));
        show($('testMsg'), d.missing.length?'warn':'ok', lines.join('\\n'));
      } else { show($('testMsg'),'err',d.error||'Connection failed.'); }
    }catch(e){ show($('testMsg'),'err',e.message); }
    b.disabled=false; b.textContent='Test connection';
  }
  async function save(){
    var b=$('saveBtn'); b.disabled=true; b.textContent='Saving…';
    show($('saveMsg'),'warn','Saving…');
    try{
      var r=await fetch('/setup/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(vals())});
      var d=await r.json();
      if(d.ok){
        $('form').style.display='none';
        $('manifestUrl').textContent=d.manifestUrl;
        var a=$('adminUrl'); a.textContent=d.adminUrl; a.href=d.adminUrl;
        $('adminPw').textContent=d.adminPassword;
        $('done').style.display='block';
        window.scrollTo(0,0);
        return;
      }
      if(d.needsForce){
        show($('saveMsg'),'warn',(d.error||'Connection test failed.')+'\\n\\nClick Save again to store these settings anyway.');
        // Next click forces.
        $('saveBtn').setAttribute('onclick','saveForce()');
      } else { show($('saveMsg'),'err',d.error||'Save failed.'); }
    }catch(e){ show($('saveMsg'),'err',e.message); }
    b.disabled=false; b.textContent='Save & start';
  }
  async function saveForce(){
    var b=$('saveBtn'); b.disabled=true; b.textContent='Saving…';
    var body=vals(); body.force=true;
    try{
      var r=await fetch('/setup/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      var d=await r.json();
      if(d.ok){
        $('form').style.display='none';
        $('manifestUrl').textContent=d.manifestUrl;
        var a=$('adminUrl'); a.textContent=d.adminUrl; a.href=d.adminUrl;
        $('adminPw').textContent=d.adminPassword;
        $('done').style.display='block'; window.scrollTo(0,0); return;
      }
      show($('saveMsg'),'err',d.error||'Save failed.');
    }catch(e){ show($('saveMsg'),'err',e.message); }
    b.disabled=false; b.textContent='Save & start';
  }
  function copy(id){ navigator.clipboard.writeText($(id).textContent); }
</script>
</body>
</html>`;
}

module.exports = { isConfigured, matches, handle };
