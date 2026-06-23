"use strict";

// Gemini fallback matcher. For releases whose folder name doesn't contain the
// English title TMDB needs (romaji Japanese, native-script Chinese/Korean,
// etc.), we ask Gemini to identify the show and return its canonical English
// title + year + original language. The caller then re-queries TMDB with that.
//
// Results are cached to data/gemini-cache.json so re-scans don't re-bill the
// API. Only definitive API responses are cached (network errors are not).

const fs = require("fs");
const path = require("path");
const config = require("../config");
const settings = require("../settings");

// Model + key come from runtime settings (editable in admin), defaulting to the
// .env values. Default model gemini-flash-latest works on the free tier.
const CACHE_FILE = path.join(config.dataDir, "gemini-cache.json");

// Gemini sometimes returns a language NAME ("Japanese") instead of the ISO
// 639-1 code we compare against TMDB's original_language ("ja"). Normalise.
const LANG_NAMES = {
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  cantonese: "zh",
  thai: "th",
  english: "en",
  tagalog: "tl",
  filipino: "tl",
  indonesian: "id",
  vietnamese: "vi",
};
function normalizeLang(lang) {
  if (!lang) return null;
  const l = String(lang).trim().toLowerCase();
  if (LANG_NAMES[l]) return LANG_NAMES[l];
  return l.length === 2 ? l : null; // keep ISO codes, drop anything else
}

let cache = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* cache is best-effort */
  }
}

function enabled() {
  return Boolean(settings.get("geminiKey"));
}

// Identify a movie or show from its release file/folder name.
// Returns { title, year, lang } or null (unidentifiable / disabled / error).
async function identify(name, type = "series") {
  if (!enabled()) return null;
  if (!cache) cache = loadCache();
  // Series keep the bare-name key (backward compatible with existing cache);
  // movies get a prefix to avoid collisions.
  const cacheKey = type === "movie" ? `movie:${name}` : name;
  if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) return cache[cacheKey];

  const kind = type === "movie" ? "movie" : "TV series";
  const yearDesc = type === "movie" ? "release year" : "first air year";
  const prompt =
    `You are given a media release name for a ${kind}. Identify the title and ` +
    'return ONLY JSON with keys: "title" (the canonical English title as listed ' +
    `on TMDB), "year" (${yearDesc} as a number, or null), "language" (ISO 639-1 ` +
    'code of the original language, or null). If you cannot identify it, return ' +
    '{"title": null, "year": null, "language": null}.' +
    "\n\nName: " +
    name;

  const model = settings.get("geminiModel");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.get("geminiKey")}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });

  // 503 (overloaded) and 429 (rate limit) are transient — retry with backoff.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 503 || res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.warn(`  Gemini HTTP ${res.status}`);
        return null; // non-transient — don't cache
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      let result = null;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && parsed.title) {
          result = {
            title: String(parsed.title),
            year: parsed.year ? Number(parsed.year) : null,
            lang: normalizeLang(parsed.language),
          };
        }
      }
      cache[cacheKey] = result; // cache the definitive answer (incl. null)
      saveCache();
      return result;
    } catch (err) {
      console.warn(`  Gemini error: ${err.message}`);
      await sleep(1000 * (attempt + 1));
    }
  }
  console.warn("  Gemini gave up after retries");
  return null;
}

module.exports = { enabled, identify };
