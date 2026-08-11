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
<link rel="icon" href="/logo.svg">
<title>Admin</title>
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
  .err { color:var(--err); border-color:var(--err); }
  .toast { position:fixed; bottom:18px; right:18px; background:var(--panel); border:1px solid var(--accent); color:var(--accent); padding:10px 14px; border-radius:8px; opacity:0; transition:opacity .2s; }
  .toast.show { opacity:1; }
  .pwrap { margin-top:14px; }
  .ptext { font-size:12px; color:var(--dim); margin-bottom:6px; display:flex; justify-content:space-between; gap:10px; }
  .ptext .cur { color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ptrack { height:10px; background:#0c100c; border:1px solid var(--line); border-radius:20px; overflow:hidden; }
  .pfill { height:100%; background:var(--accent); width:0; transition:width .4s ease; border-radius:20px; }
  .pfill.indet { width:35% !important; animation:slide 1.2s ease-in-out infinite; }
  @keyframes slide { 0%{margin-left:-35%} 100%{margin-left:100%} }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="appName">Library</h1>
  <p class="sub">Self-hosted add-on — admin panel</p>

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
    <div id="progress" class="pwrap" style="display:none"></div>
    <div class="grid" id="stats" style="margin-top:14px"></div>
    <div id="unpicked" style="margin-top:12px"></div>
    <div class="row" style="margin-top:16px">
      <button class="primary" id="btnQuick" onclick="rescan('quick')">Quick rescan</button>
      <button id="btnFull" onclick="rescan('full')">Full re-match</button>
      <button onclick="load()" title="Re-read the numbers from the server (no scan)">Refresh stats</button>
      <span class="muted" id="lastScan"></span>
    </div>
  </div>

  <div class="panel">
    <h2>Unmatched titles — pin a TMDB id</h2>
    <div id="rawBox"><span class="muted">Loading…</span></div>
  </div>

  <div class="panel">
    <div class="row" style="justify-content:space-between">
      <h2 style="margin:0">Library gaps — missing episodes</h2>
      <button onclick="gapsRefresh()">Refresh report</button>
    </div>
    <div id="gapsSummary" class="muted" style="margin-top:10px">Loading…</div>
    <div id="gapsList" style="margin-top:10px"></div>
  </div>

  <div class="panel">
    <h2>Fix a match — search your library</h2>
    <input id="fixSearch" placeholder="Search any title in your library (matched or not)…" style="width:100%" oninput="fixSearchDebounced()">
    <div id="fixResults" style="margin-top:10px"><span class="muted">Type at least 2 characters.</span></div>
    <p class="muted" style="margin-top:10px">Shows each title's current TMDB id. Edit it directly, or use "Find on TMDB" to pick the right one, then update — that re-pins it and rescans.</p>
  </div>

  <div class="panel">
    <h2>Artwork</h2>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div id="artworkForm" style="flex:1;min-width:240px"><span class="muted">Loading…</span></div>
      <div style="width:150px">
        <div class="l" style="margin-bottom:6px">Preview</div>
        <img id="artPreview" alt="poster preview" style="width:150px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;border:1px solid var(--line);background:#0c100c">
      </div>
    </div>
    <div class="row" style="margin-top:6px">
      <button class="primary" onclick="saveSettings()">Save artwork</button>
      <span class="muted">Rich BetterPosters by default; falls back to RPDB/TMDB when unavailable. Applies live.</span>
    </div>
  </div>

  <div class="panel">
    <h2>Settings</h2>
    <div id="settingsForm"><span class="muted">Loading…</span></div>
    <div class="row" style="margin-top:14px">
      <button class="primary" onclick="saveSettings()">Save settings</button>
      <button onclick="testConnection()">Test connection</button>
      <span class="muted">Applies live — no restart. Leave secret fields blank to keep them.</span>
    </div>
    <div id="connResult" class="muted" style="margin-top:10px"></div>
  </div>

  <div class="panel">
    <h2>Backup &amp; restore</h2>
    <div class="row">
      <button onclick="downloadBackup()">Download backup</button>
      <input type="file" id="restoreFile" accept="application/json,.json" style="display:none" onchange="restoreBackup(this)">
      <button onclick="document.getElementById('restoreFile').click()">Restore from file…</button>
      <span class="muted">Includes settings (with secrets), pinned titles, and the index.</span>
    </div>
    <div id="restoreResult" class="muted" style="margin-top:10px"></div>
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

let pollTimer=null;
async function load(){
  const s = await (await fetch("api/status")).json();
  if (s.name) { $("appName").textContent = s.name; document.title = s.name + " — Admin"; }
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
  renderProgress(s);
  renderRaw(s.raw);
  if(s.scanning) loadLog(); // keep the log panel live during a scan
  // Poll quickly while a scan runs so the bar moves; relax when idle.
  clearTimeout(pollTimer);
  pollTimer = setTimeout(load, s.scanning ? 2000 : 15000);
}

function renderProgress(s){
  const box=$("progress");
  const p=s.progress;
  if(!s.scanning || !p){ box.style.display="none"; box.innerHTML=""; return; }
  let label="Preparing…", done=0, total=0;
  if(p.phase==="movies"){ label="Scanning movies"; done=p.movies.done; total=p.movies.total; }
  else if(p.phase==="series"){ label="Scanning series"; done=p.series.done; total=p.series.total; }
  else if(p.phase==="posters"){ label="Checking posters"; done=p.posters.done; total=p.posters.total; }
  else if(p.phase==="saving"){ label="Saving index…"; }
  const determinate = total>0;
  const pct = determinate ? Math.min(100, Math.round(done/total*100)) : 0;
  const right = determinate ? (done+" / "+total+" ("+pct+"%)") : "";
  const cur = p.current ? esc(p.current) : "";
  box.style.display="block";
  box.innerHTML =
    '<div class="ptext"><span>'+label+(cur?' — <span class="cur">'+cur+'</span>':'')+'</span><span>'+right+'</span></div>'+
    '<div class="ptrack"><div class="pfill'+(determinate?'':' indet')+'" style="width:'+pct+'%"></div></div>'+
    '<div class="muted" style="font-size:11px;margin-top:6px">First scan can take a few minutes — it looks up each title. This page updates automatically.</div>';
}

let lastRawSig=null;
function renderRaw(raw){
  // Only rebuild when the set of unmatched titles actually changes, so the
  // auto-refresh poll never wipes ids you're typing (or steals focus).
  const sig=JSON.stringify(raw.map(r=>r.type+'|'+r.key));
  if(sig===lastRawSig) return;
  // Preserve any ids already typed (keyed by row) across a needed rebuild.
  const prev={};
  document.querySelectorAll('#rawBox input[data-k]').forEach(inp=>{ if(inp.value) prev[inp.getAttribute('data-k')]=inp.value; });
  lastRawSig=sig;
  if(!raw.length){ $("rawBox").innerHTML='<span class="ok">All titles matched 🎉</span>'; return; }
  let h='<table><tr><th>Type</th><th>Title</th><th>TMDB id</th><th></th></tr>';
  raw.forEach((r,i)=>{
    const k=r.type+'|'+r.key;
    const val=prev[k]?' value="'+esc(prev[k])+'"':'';
    h+='<tr><td><span class="tag">'+r.type+'</span></td><td>'+esc(r.name)+'</td>'
      +'<td><input id="id'+i+'" data-k="'+esc(k)+'"'+val+' placeholder="e.g. 243569" style="width:120px"></td>'
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
    field("Show my library on any title (IMDb/TMDB bridging)", sel("s_bridgeImdbIds", s.bridgeImdbIds, ["on","off"])) +
    field("Gemini model", txt("s_geminiModel", s.geminiModel, "gemini-flash-latest")) +
    field("Scan interval (minutes)", txt("s_scanIntervalMinutes", s.scanIntervalMinutes, "45")) +
    field("Seedbox base URL (HTTP file index)", txt("s_seedboxBaseUrl", s.seedboxBaseUrl, "https://host/private/")) +
    field("Seedbox username", txt("s_seedboxUser", s.seedboxUser, "")) +
    field("Seedbox password", sec("s_seedboxPass", s.seedboxPass==="set")) +
    field("Movie folders (comma-separated)", txt("s_movieDirs", s.movieDirs, "Movies")) +
    field("Series folders (comma-separated)", txt("s_seriesDirs", s.seriesDirs, "TV Shows")) +
    field("TMDB API key", sec("s_tmdbKey", s.tmdbKey==="set")) +
    field("Gemini API key", sec("s_geminiKey", s.geminiKey==="set")) +
    field("RPDB API key", sec("s_rpdbKey", s.rpdbKey==="set")) +
    field("New admin password (blank keeps current)", sec("s_adminPassword", s.adminPassword==="set"));

  const optsel=(id,val,pairs)=>'<select id="'+id+'" style="width:100%" onchange="updateArtPreview()">'+pairs.map(p=>'<option value="'+p[0]+'"'+(p[0]===val?' selected':'')+'>'+p[1]+'</option>').join('')+'</select>';
  const LANGS=[['en','English'],['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ru','Russian'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['hi','Hindi'],['ar','Arabic'],['tr','Turkish'],['nl','Dutch'],['pl','Polish'],['sv','Swedish']];
  const RS=[['AV','Average'],['IM','IMDb'],['TM','TMDB'],['RT','Rotten Tomatoes'],['MC','Metacritic'],['TR','Trakt']];
  $("artworkForm").innerHTML =
    field("Poster language", optsel("s_posterLang", s.posterLang||'en', LANGS)) +
    field("Rating source", optsel("s_posterRatingSource", s.posterRatingSource||'AV', RS));
  updateArtPreview();
}

function updateArtPreview(){
  const langEl=$("s_posterLang"), rsEl=$("s_posterRatingSource");
  if(!langEl||!rsEl) return;
  const p=[]; if(rsEl.value&&rsEl.value!=='AV')p.push('rs='+rsEl.value); if(langEl.value&&langEl.value!=='en')p.push('lang='+langEl.value);
  p.push('cb='+Date.now()); // cache-buster so the preview refreshes
  $("artPreview").src='https://btttr.cc/poster-qa/imdb/poster-default/tt0903747.jpg?'+p.join('&');
}
function showConn(c){
  const el=$("connResult"); if(!el) return;
  if(!c){ el.textContent=""; el.className="muted"; return; }
  if(c.ok){ el.textContent="✓ Connected to seedbox"+(c.status?" (HTTP "+c.status+")":""); el.className="ok"; }
  else { el.textContent="✗ "+(c.error||"Connection failed"); el.className="err"; }
}
async function saveSettings(){
  const v=(id)=>$(id).value;
  const body={ posterSource:v("s_posterSource"), posterLang:v("s_posterLang"), posterRatingSource:v("s_posterRatingSource"),
    geminiModel:v("s_geminiModel"), bridgeImdbIds:v("s_bridgeImdbIds"),
    scanIntervalMinutes:v("s_scanIntervalMinutes"), seedboxBaseUrl:v("s_seedboxBaseUrl"),
    seedboxUser:v("s_seedboxUser"), seedboxPass:v("s_seedboxPass"),
    movieDirs:v("s_movieDirs"), seriesDirs:v("s_seriesDirs"),
    tmdbKey:v("s_tmdbKey"), geminiKey:v("s_geminiKey"), rpdbKey:v("s_rpdbKey"),
    adminPassword:v("s_adminPassword") };
  const r = await (await fetch("api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).json();
  toast("Settings saved (live)");
  showConn(r && r.connection); // present only when connection fields were touched
  loadSettings();
}

async function testConnection(){
  const el=$("connResult"); if(el){ el.textContent="Testing…"; el.className="busy"; }
  try {
    const c = await (await fetch("api/test-connection",{method:"POST"})).json();
    showConn(c);
  } catch(e){ showConn({ok:false,error:String(e)}); }
}

async function downloadBackup(){
  try {
    const r = await fetch("api/backup");
    if(!r.ok){ toast("Backup failed"); return; }
    const blob = await r.blob();
    const cd = r.headers.get("content-disposition")||"";
    const m = cd.match(/filename="([^"]+)"/);
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download = m?m[1]:"nuvio-backup.json"; a.click(); URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  } catch(e){ toast("Backup failed"); }
}
async function restoreBackup(input){
  const file = input.files && input.files[0]; input.value="";
  if(!file) return;
  if(!confirm("Restore overwrites current settings, pins, and index. Continue?")) return;
  const el=$("restoreResult"); el.textContent="Restoring…"; el.className="busy";
  try {
    const text = await file.text();
    const r = await (await fetch("api/restore",{method:"POST",headers:{"Content-Type":"application/json"},body:text})).json();
    if(r.ok){ el.textContent="✓ Restored: "+(r.restored.join(", ")||"nothing"); el.className="ok"; toast("Restored"); setTimeout(()=>{load();loadSettings();},1200); }
    else { el.textContent="✗ "+(r.error||"Restore failed"); el.className="err"; }
  } catch(e){ el.textContent="✗ "+String(e); el.className="err"; }
}

async function loadGaps(){
  let r; try { r=await (await fetch("api/gaps")).json(); } catch(e){ return; }
  const sum=$("gapsSummary"), list=$("gapsList");
  if(r.running){ sum.className="busy"; sum.textContent="Building report…"; setTimeout(loadGaps,4000); return; }
  if(!r.report){ sum.className="muted"; sum.textContent="No report yet — click Refresh (it checks every matched series against TMDB)."; list.innerHTML=""; return; }
  const s=r.report.summary||{};
  sum.className="muted";
  sum.textContent=s.complete+" complete · "+s.withGaps+" with gaps · "+s.missingEpisodes+" aired episodes missing"
    +(s.skippedUnmatched?" · "+s.skippedUnmatched+" unmatched skipped":"")
    +" · generated "+new Date(r.report.generatedAt).toLocaleString();
  const series=r.report.series||[];
  if(!series.length){ list.innerHTML='<span class="ok">Every matched series is complete 🎉</span>'; return; }
  let h='<table><tr><th>Series</th><th>Have</th><th>Missing</th></tr>';
  series.forEach(function(x){
    const detail=x.seasons.map(function(se){ return "S"+se.season+": "+se.missing.join(", "); }).join(" · ");
    const suspect=x.suspectMismatch?' <span class="tag" style="color:var(--err);border-color:var(--err)" title="Episode count is far off — this is probably a wrong TMDB match, not missing files. Fix it in “Fix a match” below.">check match</span>':'';
    h+='<tr><td>'+esc(x.name)+(x.status?' <span class="muted">('+esc(x.status)+')</span>':'')+suspect+'</td>'
      +'<td class="muted">'+x.haveTotal+'/'+x.airedTotal+'</td>'
      +'<td><span class="tag" style="color:var(--warn);border-color:var(--warn)">'+x.missingCount+'</span> <span class="muted">'+esc(detail)+'</span></td></tr>';
  });
  list.innerHTML=h+'</table>';
}
async function gapsRefresh(){
  await fetch("api/gaps/refresh",{method:"POST"});
  const sum=$("gapsSummary"); sum.className="busy"; sum.textContent="Building report… (first run checks every series against TMDB)";
  setTimeout(loadGaps,4000);
}

let fixItems=[], fixTimer=null;
function fixSearchDebounced(){ clearTimeout(fixTimer); fixTimer=setTimeout(fixSearch,300); }
async function fixSearch(){
  const q=$("fixSearch").value.trim();
  if(q.length<2){ $("fixResults").innerHTML='<span class="muted">Type at least 2 characters.</span>'; return; }
  let r; try { r=await (await fetch("api/library/search?q="+encodeURIComponent(q))).json(); } catch(e){ return; }
  fixItems=r.items||[];
  if(!fixItems.length){ $("fixResults").innerHTML='<span class="muted">Nothing in your library matches that.</span>'; return; }
  let h='<table><tr><th>Type</th><th>Title</th><th>TMDB id</th><th></th></tr>';
  fixItems.forEach(function(it,i){
    const warn=it.matched?'':' <span class="tag" style="color:var(--warn);border-color:var(--warn)">unmatched</span>';
    h+='<tr><td><span class="tag">'+it.type+'</span></td>'
      +'<td>'+esc(it.name)+(it.year?' <span class="muted">('+esc(it.year)+')</span>':'')+warn+'</td>'
      +'<td><input id="fixId'+i+'" value="'+(it.tmdbId||'')+'" placeholder="none" style="width:110px"></td>'
      +'<td style="white-space:nowrap"><button onclick="tmdbLookup('+i+')">Find on TMDB</button> '
      +'<button class="primary" onclick="fixApply('+i+')">Update &amp; rescan</button></td></tr>'
      +'<tr><td colspan="4" id="fixCand'+i+'" style="padding:0;border:0"></td></tr>';
  });
  $("fixResults").innerHTML=h+'</table>';
}
async function tmdbLookup(i){
  const it=fixItems[i]; if(!it) return;
  const cell=$("fixCand"+i); cell.innerHTML='<span class="muted" style="display:block;padding:6px 0">Searching TMDB…</span>';
  let r; try { r=await (await fetch("api/tmdb/search?type="+encodeURIComponent(it.type)+"&q="+encodeURIComponent(it.name))).json(); } catch(e){ cell.innerHTML='<span class="err">TMDB search failed.</span>'; return; }
  const res=r.results||[];
  if(!res.length){ cell.innerHTML='<span class="muted" style="display:block;padding:6px 0">No TMDB results — try editing the id manually.</span>'; return; }
  cell.innerHTML='<div style="padding:6px 0 10px 0">'+res.map(function(c){
    return '<div class="row" style="justify-content:space-between;padding:2px 0">'
      +'<span>'+esc(c.name)+(c.year?' <span class="muted">('+esc(c.year)+')</span>':'')+' <span class="muted">#'+c.tmdbId+'</span></span>'
      +'<button onclick="fixPick('+i+','+c.tmdbId+')">use this</button></div>';
  }).join("")+'</div>';
}
function fixPick(i,id){
  $("fixId"+i).value=id;
  $("fixCand"+i).innerHTML='<span class="ok" style="display:block;padding:6px 0">Set to '+id+' — now click "Update &amp; rescan".</span>';
}
async function fixApply(i){
  const it=fixItems[i]; if(!it) return;
  const tmdbId=$("fixId"+i).value.trim();
  if(!tmdbId){ toast("Enter a TMDB id"); return; }
  if(!it.keys||!it.keys.length){ toast("No override key for this item — rescan first"); return; }
  const r=await (await fetch("api/override",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:it.type,keys:it.keys,tmdbId:tmdbId})})).json();
  if(r.ok){ $("fixCand"+i).innerHTML='<span class="ok" style="display:block;padding:6px 0">Pinned to '+esc(tmdbId)+' — rescanning…</span>'; toast("Updated — rescanning"); setTimeout(load,1500); }
  else { toast(r.error||"Failed"); }
}

async function loadLog(){ const r=await (await fetch("api/log")).json(); $("log").textContent=r.log; $("log").scrollTop=$("log").scrollHeight; }

load(); loadSettings(); loadLog(); loadGaps();
</script>
</body>
</html>`;
};
