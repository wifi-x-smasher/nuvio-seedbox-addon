"use strict";

// Unit tests for the ASS/SSA -> SRT converter used by the subtitle relay.
// Run with: npm test  (uses node:test, no extra deps).

const test = require("node:test");
const assert = require("node:assert/strict");

const { assToSrt } = require("../src/subs/ass");

const SAMPLE = [
  "[Script Info]",
  "Title: Example",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello {\\i1}world{\\i0}\\Nsecond line",
  "Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,Later, with a comma",
].join("\n");

test("assToSrt: converts timing, strips tags, keeps commas in text", () => {
  const srt = assToSrt(SAMPLE);
  const expected =
    "1\n00:00:01,000 --> 00:00:03,500\nHello world\nsecond line\n\n" +
    "2\n00:00:05,000 --> 00:00:06,000\nLater, with a comma\n\n";
  assert.equal(srt, expected);
});

test("assToSrt: sorts events by start time", () => {
  const outOfOrder = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,second",
    "Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,first",
  ].join("\n");
  const srt = assToSrt(outOfOrder);
  assert.match(srt, /^1\n00:00:02,000 --> 00:00:03,000\nfirst\n\n2\n/);
});

test("assToSrt: no dialogue -> empty string", () => {
  assert.equal(assToSrt("[Script Info]\nTitle: x\n"), "");
});

test("assToSrt: drops lines that clean to empty text", () => {
  const onlyTags = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(10,10)}",
  ].join("\n");
  assert.equal(assToSrt(onlyTags), "");
});
