"use strict";

// Minimal ASS/SSA -> SRT converter. Desktop mpv renders ASS natively, but many
// mobile players don't, so the relay converts sidecar .ass/.ssa to SRT (which
// renders everywhere). Styling/positioning is dropped; dialogue + timing kept.

// "0:00:01.23" (H:MM:SS.cs) -> seconds.
function parseAssTime(t) {
  const m = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(t || "");
  if (!m) return 0;
  const cs = m[4].padEnd(2, "0").slice(0, 2); // centiseconds
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(cs) / 100;
}

// seconds -> "HH:MM:SS,mmm".
function fmtSrtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
}

// Split a Dialogue line into exactly `count` fields; the final field (Text) may
// itself contain commas, so we only split on the first count-1 commas.
function splitFields(rest, count) {
  const out = [];
  let from = 0;
  for (let i = 0; i < count - 1; i++) {
    const idx = rest.indexOf(",", from);
    if (idx === -1) break;
    out.push(rest.slice(from, idx));
    from = idx + 1;
  }
  out.push(rest.slice(from));
  return out;
}

function cleanText(text) {
  return (text || "")
    .replace(/\{[^}]*\}/g, "") // {\pos(..)}, {\i1} override blocks
    .replace(/\\N/gi, "\n") // hard line break
    .replace(/\\h/gi, " ") // hard space
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function assToSrt(ass) {
  const lines = ass.split(/\r?\n/);
  let inEvents = false;
  let format = null;
  const events = [];

  for (const line of lines) {
    if (/^\[/.test(line)) {
      inEvents = /^\[events\]/i.test(line.trim());
      continue;
    }
    if (!inEvents) continue;

    if (/^Format:/i.test(line)) {
      format = line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim().toLowerCase());
      continue;
    }
    if (/^Dialogue:/i.test(line) && format) {
      const rest = line.slice(line.indexOf(":") + 1);
      const parts = splitFields(rest, format.length);
      const row = {};
      format.forEach((k, i) => (row[k] = (parts[i] || "").trim()));
      const text = cleanText(row.text);
      if (text) events.push({ start: parseAssTime(row.start), end: parseAssTime(row.end), text });
    }
  }

  events.sort((a, b) => a.start - b.start || a.end - b.end);

  let out = "";
  let n = 1;
  for (const e of events) {
    out += `${n}\n${fmtSrtTime(e.start)} --> ${fmtSrtTime(e.end)}\n${e.text}\n\n`;
    n++;
  }
  return out;
}

module.exports = { assToSrt };
