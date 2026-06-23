"use strict";

const VIDEO_EXTS = new Set([
  ".mkv", ".mp4", ".avi", ".m4v", ".mov", ".ts", ".wmv", ".webm", ".flv", ".mpg", ".mpeg",
]);
const SUBTITLE_EXTS = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub"]);
const ARCHIVE_EXTS = new Set([".zip", ".rar"]);

function ext(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function stripExt(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(0, i) : name;
}

const isVideo = (name) => VIDEO_EXTS.has(ext(name));
const isSubtitle = (name) => SUBTITLE_EXTS.has(ext(name));
const isArchive = (name) => ARCHIVE_EXTS.has(ext(name));

module.exports = {
  VIDEO_EXTS,
  SUBTITLE_EXTS,
  ARCHIVE_EXTS,
  ext,
  stripExt,
  isVideo,
  isSubtitle,
  isArchive,
};
