"use strict";

// Self-contained admin dashboard (no build step, no external deps). Served at
// <base>/<secret>/admin. API calls are relative so they stay under the secret
// path. Auth is handled by the server (HTTP Basic via ADMIN_PASSWORD).

module.exports = function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Whatbox Library — Admin</title>
<style>
  :root { --bg:#0c0f0c; --panel:#121612; --line:#1f271f; --fg:#d6e6d6; --dim:#7c8c7c; --accent:#8bff80; --warn:#ffb454; --err:#ff6b6b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  .wrap { max-width:1000px; margin:0 auto; padding:24px 18px 60px; }
  h1 { font-size:26px; margin:0 0 2px; letter-spacing:1px; }
  .sub { color:var(--dim); margin:0 0 22px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:18px; }
  .panel h2 { font-size:13px; text-transform:uppercase; letter-spacing:2px; color:var(--dim); margin:0 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:14px; }
  .stat .n { font-size:24px; font-weight:700; color:var(--accent); }
  .stat .l { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--dim); }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .muted { color:var(--dim); }
  button { background:#1b231b; color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:9px 14px; cursor:pointer; font:inherit; }
  button:hover { border-color:var(--accent); color:var(--accent); }
  button:disabled { opacity:.5; cursor:default; }
  button.primary { background:var(--accent); color:#06200a; border-color:var(--accent); font-weight:700; }
  input { background:#0c100c; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:7px 9px; font:inherit; }
  code { background:#0c100c; border:1px solid var(--line); border-radius:6px; padding:7px 9px; display:block; overflow:auto; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { color:var(--dim); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  .tag { font-size:11px; padding:1px 7px; border-radius:20px; border:1px solid var(--line); color:var(--dim); }
  pre { background:#080b08; border:1px solid var(--line); border-radius:8px; padding:12px; max-height:340px; overflow:auto; color:#bcd; font-size:12px; }
  .badge { font-size:12px; padding:2px 10px; border-radius:20px; border:1px solid var(--line); }
  .ok { color:var(--accent); border-color:var(--accent); }
  .busy { color:var(--warn); border-color:var(--warn); }
  .toast { position:fixed; bottom:18px; right:18px; background:var(--panel); border:1px solid var(--accent); color:var(--accent); padding:10px 14px; border-radius:8px; opacity:0; transition:opacity .2s; }
  .toast.show { opacity:1; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Whatbox Library</h1>
  <p class="sub">Private add-on — admin panel</p>

  <div class="panel">
    <h2>Manifest</h2>
    <code id="manifest">…</code>
    <div class="row" style="margin-top:10px">
      <button onclick="copyManifest()">Copy URL</button>
      <span class="muted">Add this in Nuvio on every device.</span>
    </div>
  </div>

  <div class="panel">
    <div class="row" style="justify-content:space-between">
      <h2 style="margin:0">Index status</h2>
      <span id="scanState" class="badge ok">idle</span>
    </div>
    <div class="grid" id="stats" style="margin-top:14px"></div>
    <div id="unpicked" style="margin-top:12px"></div>
    <div class="row" style="margin-top:16px">
      <button class="primary" id="btnQuick" onclick="rescan('quick')">Quick rescan</button>
      <button id="btnFull" onclick="rescan('full')">Full re-match</button>
      <button onclick="load()">Refresh</button>
      <span class="muted" id="lastScan"></span>
    </div>
  </div>

  <div class="panel">
    <h2>Unmatched titles — pin a TMDB id</h2>
    <div id="rawBox"><span class="muted">Loading…</span></div>
  </div>

  <div class="panel">
    <h2>Settings</h2>
    <div id="settingsForm"><span class="muted">Loading…</span></div>
    <div class="row" style="margin-top:14px">
      <button class="primary" onclick="saveSettings()">Save settings</button>
      <span class="muted">Applies live — no restart. Leave secret fields blank to keep them.</span>
    </div>
  </div>

  <div class="panel">
    <div class="row" style="justify-content:space-between">
      <h2 style="margin:0">Recent log</h2>
      <button onclick="loadLog()">Refresh log</button>
    </div>
    <pre id="log" style="margin-top:12px">…</pre>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2200); }
function copyManifest(){ navigator.clipboard.writeText($("manifest").textContent).then(()=>toast("Manifest URL copied")); }

async function load(){
  const s = await (await fetch("api/status")).json();
  $("manifest").textContent = s.manifestUrl;
  const langs = Object.entries(s.byLang).map(([k,v])=>k.toUpperCase()+" "+v).join(" · ") || "—";
  $("stats").innerHTML = [
    ["Items", s.movies+s.series],["Movies", s.movies],["Series", s.series],
    ["Episodes", s.episodes],["Matched", s.matched],["Unmatched", s.rawCount],
    ["Subtitled", s.subbedItems],["Sub files", s.subFiles],["Unpicked subs", s.unpickedSubs],
    ["Skipped folders", s.skippedCount],
  ].map(([l,n])=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join("")
   + '<div class="stat"><div class="n" style="font-size:14px">'+langs+'</div><div class="l">By language</div></div>';
  const detailsBlock=(items,label)=>'<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--warn)">'+items.length+' '+label+'</summary><ul style="color:var(--warn);margin:8px 0 0;padding-left:20px">'+items.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></details>';
  $("unpicked").innerHTML =
    (s.unpickedSubs ? detailsBlock(s.unpickedList, 'unpicked subtitle file(s) — present but not attached to any video') : '') +
    (s.skippedCount ? detailsBlock(s.skippedList, 'skipped folder(s) — no playable video (subtitle-only/empty)') : '');
  $("lastScan").textContent = s.lastScan ? "Last scan: "+new Date(s.lastScan).toLocaleString() : "";
  const st=$("scanState"); st.textContent = s.scanning ? "scanning…" : "idle";
  st.className = "badge "+(s.scanning?"busy":"ok");
  $("btnQuick").disabled = s.scanning; $("btnFull").disabled = s.scanning;
  renderRaw(s.raw);
}

function renderRaw(raw){
  if(!raw.length){ $("rawBox").innerHTML='<span class="ok">All titles matched 🎉</span>'; return; }
  let h='<table><tr><th>Type</th><th>Title</th><th>TMDB id</th><th></th></tr>';
  raw.forEach((r,i)=>{
    h+='<tr><td><span class="tag">'+r.type+'</span></td><td>'+esc(r.name)+'</td>'
      +'<td><input id="id'+i+'" placeholder="e.g. 243569" style="width:120px"></td>'
      +'<td><button onclick="pin(\\''+r.type+'\\',\\''+esc(r.key).replace(/\'/g,"\\\\'")+'\\','+i+')">Pin</button></td></tr>';
  });
  $("rawBox").innerHTML = h+'</table><p class="muted" style="margin-top:10px">Find the id in the TMDB page URL (themoviedb.org/tv/<b>243569</b>-…). Pinning triggers a rescan.</p>';
}
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

async function pin(type,key,i){
  const tmdbId = $("id"+i).value.trim();
  if(!tmdbId){ toast("Enter a TMDB id"); return; }
  const r = await (await fetch("api/override",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,key,tmdbId})})).json();
  if(r.ok){ toast("Pinned — rescanning"); setTimeout(load,1500); } else { toast(r.error||"Failed"); }
}

async function rescan(mode){
  if(mode==="full" && !confirm("Full re-match clears the cache and re-queries everything. Continue?")) return;
  await fetch("api/rescan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode})});
  toast(mode==="full"?"Full re-match started":"Rescan started");
  setTimeout(load,1500);
}

async function loadSettings(){
  const s = await (await fetch("api/settings")).json();
  const field=(label,html)=>'<label style="display:block;margin-bottom:12px"><div class="l" style="margin-bottom:4px">'+label+'</div>'+html+'</label>';
  const sel=(id,val,opts)=>'<select id="'+id+'" style="width:100%">'+opts.map(o=>'<option'+(o===val?' selected':'')+'>'+o+'</option>').join('')+'</select>';
  const txt=(id,val,ph)=>'<input id="'+id+'" value="'+esc(val||'')+'" placeholder="'+esc(ph||'')+'" style="width:100%">';
  const sec=(id,isSet)=>'<input id="'+id+'" type="password" autocomplete="new-password" placeholder="'+(isSet?'•••••• (set — blank keeps it)':'not set')+'" style="width:100%">';
  $("settingsForm").innerHTML =
    field("Poster source", sel("s_posterSource", s.posterSource, ["better","rpdb","tmdb"])) +
    field("Gemini model", txt("s_geminiModel", s.geminiModel, "gemini-flash-latest")) +
    field("Scan interval (minutes)", txt("s_scanIntervalMinutes", s.scanIntervalMinutes, "45")) +
    field("Seedbox base URL (HTTP file index)", txt("s_whatboxBaseUrl", s.whatboxBaseUrl, "https://host/private/")) +
    field("Seedbox username", txt("s_whatboxUser", s.whatboxUser, "")) +
    field("Seedbox password", sec("s_whatboxPass", s.whatboxPass==="set")) +
    field("Movie folders (comma-separated)", txt("s_movieDirs", s.movieDirs, "Movies")) +
    field("Series folders (comma-separated)", txt("s_seriesDirs", s.seriesDirs, "TV Shows")) +
    field("TMDB API key", sec("s_tmdbKey", s.tmdbKey==="set")) +
    field("Gemini API key", sec("s_geminiKey", s.geminiKey==="set")) +
    field("RPDB API key", sec("s_rpdbKey", s.rpdbKey==="set"));
}
async function saveSettings(){
  const v=(id)=>$(id).value;
  const body={ posterSource:v("s_posterSource"), geminiModel:v("s_geminiModel"),
    scanIntervalMinutes:v("s_scanIntervalMinutes"), whatboxBaseUrl:v("s_whatboxBaseUrl"),
    whatboxUser:v("s_whatboxUser"), whatboxPass:v("s_whatboxPass"),
    movieDirs:v("s_movieDirs"), seriesDirs:v("s_seriesDirs"),
    tmdbKey:v("s_tmdbKey"), geminiKey:v("s_geminiKey"), rpdbKey:v("s_rpdbKey") };
  await fetch("api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  toast("Settings saved (live)"); loadSettings();
}

async function loadLog(){ const r=await (await fetch("api/log")).json(); $("log").textContent=r.log; $("log").scrollTop=$("log").scrollHeight; }

load(); loadSettings(); loadLog(); setInterval(load, 15000);
</script>
</body>
</html>`;
};
