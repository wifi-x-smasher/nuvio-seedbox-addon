"use strict";

// In-memory ring buffer of recent log lines, so the admin panel's "Recent log"
// can show what's happening without depending on a log file. install() mirrors
// the server's own console output here (still printed to the terminal too); the
// scan child's piped output is fed in via push(). Cleared on restart.

const MAX_LINES = 600;
const lines = [];

function pushLine(s) {
  lines.push(s);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

// Append raw output (may contain several newlines), e.g. from a child process.
function push(chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length) pushLine(line);
  }
}

function fmt(args) {
  const stamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const msg = args
    .map((a) => (typeof a === "string" ? a : (() => {
      try { return JSON.stringify(a); } catch { return String(a); }
    })()))
    .join(" ");
  return `${stamp} ${msg}`;
}

// Patch console.* on this process to also record into the buffer.
function install() {
  for (const level of ["log", "info", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      try { pushLine(fmt(args)); } catch { /* never let logging throw */ }
    };
  }
}

function tail(n = 200) {
  return lines.slice(-n).join("\n") || "(no log yet)";
}

module.exports = { install, push, tail };
