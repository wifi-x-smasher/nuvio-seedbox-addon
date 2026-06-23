"use strict";

const PTN = require("parse-torrent-name");
const media = require("../util/media");

// Parse a media filename into title/year/season/episode/quality.
// Handles both dot-separated and space-separated release names.
function parseName(filename) {
  const base = media.stripExt(filename);
  const info = PTN(base) || {};
  const season = info.season != null ? Number(info.season) : null;
  const episode = info.episode != null ? Number(info.episode) : null;
  return {
    title: (info.title || base).trim(),
    year: info.year != null ? Number(info.year) : null,
    season,
    episode,
    resolution: info.resolution || null,
    isSeries: season != null && episode != null,
    raw: base,
  };
}

// Known subtitle language codes/names we recognise in filenames.
const LANG_CODES = new Set([
  "en", "eng", "english", "ko", "kor", "korean", "ja", "jp", "jpn", "japanese",
  "zh", "chi", "chs", "cht", "chinese", "th", "tha", "thai", "es", "spa",
  "fr", "fre", "de", "ger", "pt", "por", "ru", "rus", "id", "ind", "vi", "vie", "hi",
]);

// Detect a subtitle's language. Prefer a language token right after the video
// base name (e.g. "Foo.Bar.en" -> "en"); otherwise sniff a trailing language
// token from the sub's own filename (handles subs whose name doesn't match the
// video's, e.g. "...AAC-SeeWEB.en.srt"). Returns "und" if none found.
function subtitleLang(subBase, videoBase) {
  if (videoBase && subBase.startsWith(videoBase + ".")) {
    const first = subBase.slice(videoBase.length + 1).toLowerCase().split(".")[0];
    if (first && LANG_CODES.has(first)) return first;
  }
  const tokens = subBase.toLowerCase().split(/[.\-_ ]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= Math.max(0, tokens.length - 2); i--) {
    if (LANG_CODES.has(tokens[i])) return tokens[i];
  }
  return "und";
}

// Parse a TV-show folder name into {title, year, season} for grouping/display.
// e.g. "Switch.Girl.S02.1080p..." -> title "Switch Girl", season 2.
//
// Note: we strip season/release tokens from the title (so split seasons group
// together and names look tidy) but never strip years, because some titles ARE
// years (e.g. "Reply 1988" vs "Reply 1994" must stay distinct).
function parseFolderTitle(folderName) {
  // Strip [..] tag groups first (fansub/release tags like "[MagicStar]",
  // "[WEBDL]", "[1080p]", or a native-script name) so they don't leak into the
  // parsed title. Parentheses (often the year) are kept for PTN.
  const cleaned = folderName.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

  const info = PTN(cleaned) || {};
  let title = (info.title || cleaned).trim();
  let season = info.season != null ? Number(info.season) : null;

  if (season == null) {
    const sm = cleaned.match(/\bS(?:eason)?[ ._]*(\d{1,2})\b/i);
    if (sm) season = Number(sm[1]);
  }

  // Year fallback: PTN sometimes misses a year that sits after the season
  // token (e.g. "Perfect.Family.S01.2024.1080p"). Match a standalone 19xx/20xx.
  let year = info.year != null ? Number(info.year) : null;
  if (year == null) {
    const ym = cleaned.match(/\b(19\d{2}|20\d{2})\b/);
    if (ym) year = Number(ym[1]);
  }

  // Drop a leading native-script (CJK/Kana/Hangul) segment when a Latin title
  // follows (e.g. "我和我的时光少年 Flourish in Time" -> "Flourish in Time").
  if (/[A-Za-z]/.test(title) && /[぀-ヿ㐀-鿿가-힯]/.test(title)) {
    title = title.replace(/^[\s.]*[぀-ヿ㐀-鿿가-힯][^A-Za-z]*/, "").trim();
  }

  // Trim at the first season/quality/source/codec marker that PTN left behind.
  title = title
    .replace(
      /[ ._-]*\b(S(?:eason)?[ ._]*\d{1,2}|\d{3,4}p|4K|Complete|WEB[ ._-]?DL|WEBRip|BluRay|HDTV|x26[45]|H[ ._]?26[45])\b.*$/i,
      "",
    )
    .trim();

  // Strip a trailing leaked release year (PTN sometimes leaves it in the title,
  // e.g. "When The Phone Rings 2024"). Safe: genuine year-in-title shows like
  // "Reply 1994" get the year split off by PTN, so it never trails here.
  if (year) title = title.replace(new RegExp(`[ ._-]*\\b${year}\\b\\s*$`), "").trim();

  if (!title) title = (info.title || cleaned).trim();

  return { title, year, season };
}

// Pull season/episode numbers out of an episode filename. Handles SxxExx,
// 1x01, bare Exx / EPxx, and " - NN" (season unknown -> null). Falls back to PTN.
function parseEpisode(filename) {
  const base = media.stripExt(filename);

  let m = base.match(/S(\d{1,2})[ ._-]*E(\d{1,3})/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };

  m = base.match(/\b(\d{1,2})x(\d{1,2})\b/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };

  // Bare "E01" / "EP01" / "ep01" (P is the common "EPisode" prefix).
  m = base.match(/(?:^|[^A-Za-z0-9])EP?(\d{1,3})(?:[^0-9]|$)/i);
  if (m) return { season: null, episode: Number(m[1]) };

  // Fansub style " - 01 " (e.g. "[NOP] Last Cinderella - 01 [1080p]").
  m = base.match(/[\s.]-\s*(\d{1,3})(?=[\s.[]|$)/);
  if (m) return { season: null, episode: Number(m[1]) };

  const info = PTN(base) || {};
  if (info.episode != null) {
    return {
      season: info.season != null ? Number(info.season) : null,
      episode: Number(info.episode),
    };
  }
  return { season: null, episode: null };
}

// Normalize a title for grouping multi-folder shows (lowercase, strip punctuation).
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Anime fansub group tags signal the release is actually anime (so we should
// prefer the animated TMDB entry instead of a same-title live-action drama).
const ANIME_FANSUB = /\[(SubsPlease|Erai-raws|HorribleSubs|Anime[ ._-]?Time|EMBER|Judas|ASW|Commie|Doki|Coalgirls|Nyaa)\]/i;
function looksLikeAnime(folderName) {
  return ANIME_FANSUB.test(folderName);
}

// Infer the origin language from region-exclusive streaming-platform / language
// tags in the release name. Returns an ISO code or null (ambiguous/none). Only
// high-confidence, region-exclusive tags are listed — a wrong hint would
// penalise the correct match, so we stay conservative.
const LANG_TAGS = [
  ["ko", /\b(TVING|WAVVE|KOCOWA|tvN|JTBC|KBS|SBS|MBC|ENA|OCN|WATCHA|KOREAN)\b/i],
  ["zh", /\b(IQIYI|YOUKU|WETV|MGTV|TENCENT|CROTON|BILIBILI|MANGO|CHINESE)\b/i],
  ["ja", /\b(PARAVI|FOD|U-?NEXT|NHK|TVER|ABEMA|LEMINO|JAPANESE)\b/i],
  ["th", /\b(GMMTV|GMM25|TRUEID|THAI)\b/i],
];
function inferOriginLang(folderName) {
  const hits = LANG_TAGS.filter(([, re]) => re.test(folderName)).map(([l]) => l);
  return hits.length === 1 ? hits[0] : null;
}

module.exports = {
  parseName,
  subtitleLang,
  parseFolderTitle,
  parseEpisode,
  normalizeTitle,
  looksLikeAnime,
  inferOriginLang,
};
