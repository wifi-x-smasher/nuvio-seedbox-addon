# nuvio-seedbox-addon

A self-hosted [Stremio](https://www.stremio.com/) / [Nuvio](https://github.com/NuvioMedia) add-on that turns **your own seedbox** into browsable catalogs with TMDB metadata, **direct streaming**, and **external subtitles** — all configured from a browser, no code editing required.

Point it at any seedbox that serves an HTTP file index (the classic *"Index of /…"* listing) behind HTTP Basic auth. It scans your library, matches each title against TMDB (with an optional Gemini fallback for tricky/foreign titles), and exposes everything to your player. Streams go **player → seedbox directly**, so the add-on host only does light metadata work.

> **Bring your own everything.** Your seedbox URL, credentials, and API keys stay in your own deployment (`data/settings.json`, gitignored). Nothing is shared with anyone.

---

## Features

- 📚 **Catalogs** for movies and series, with per-language series rows (K-Drama / C-Drama / J-Drama / Thai / Other).
- ▶️ **Direct streaming** — the player fetches from your seedbox with auth headers attached; no re-streaming through the add-on.
- 💬 **External subtitles** — sidecar `.srt`/`.ass`/`.ssa` files are matched and served (ASS/SSA converted to SRT on the fly).
- 🖼️ **Rich metadata** — posters (BetterPosters → RPDB → TMDB), cast, ratings, runtime, trailers, logos, and per-episode stills/overviews.
- 🧠 **Smart matching** — filename parsing + TMDB search, with an optional Gemini fallback for hard titles.
- 🔁 **Incremental auto re-index** — only new/removed media is reprocessed on a schedule; new downloads appear automatically.
- 🛠️ **Admin panel** — library health, subtitle coverage, unmatched-title fixer, manual rescan, and live-editable settings.
- 🔒 **Private by default** — an unguessable secret path gates all access; a separate password protects the admin panel.

---

## Quick start (Docker)

```bash
git clone https://github.com/wifi-x-smasher/nuvio-seedbox-addon.git
cd nuvio-seedbox-addon
docker compose up -d
```

Then open **http://localhost:7700/setup** and complete the form:

1. **Seedbox connection** — your index URL + username/password. Hit **Test connection** to confirm it's reachable and your `Movies` / `TV Shows` folders are found.
2. **Metadata** — a (free) [TMDB API key](https://www.themoviedb.org/settings/api). Gemini and RPDB keys are optional.
3. **This add-on** — a display name, and optionally a public URL (auto-detected otherwise).

On save, the add-on generates a secret access path and an admin password (shown once — **save it**), then kicks off the first library scan. You'll get an **install URL** to paste into Nuvio/Stremio → *Add-ons → Install via URL*.

That's it. No `.env` editing needed.

---

## How it works

```
 Nuvio / Stremio  ──manifest/catalog/meta──▶  add-on  ──HTTP index + TMDB──▶  metadata
        │                                        │
        └────────── stream URL (+auth) ──────────┴──────────▶  your seedbox (direct)
```

The add-on never proxies video. It hands the player a direct seedbox URL plus an `Authorization` header (via Stremio `behaviorHints.proxyHeaders`), so playback speed is whatever your seedbox can serve. Only subtitles are relayed (the subtitle protocol can't carry auth), and those are tiny.

---

## Requirements

- A seedbox exposing an **HTTP auto-index** with **Basic auth** and **range requests** (seeking). Most managed seedboxes (Whatbox, Seedhost, Ultra.cc, etc.) can do this, or any nginx/Apache `autoindex`.
- A **TMDB API key** (free).
- Node.js 18+ **or** Docker.
- Media laid out as `Movies/<Title>/<file>` and `TV Shows/<Show>/<Season>/<file>` (folder names are configurable).

Optional: a **Gemini API key** (better matching of foreign titles) and an **RPDB key** (rating posters).

---

## Configuration

Everything is set through `/setup` and the admin panel and persisted to `data/settings.json`. You can change credentials, API keys, poster source, scan interval, and library folders later from **Admin → Settings** without a restart.

Prefer environment variables (e.g. for immutable deploys)? Copy [`.env.example`](.env.example) to `.env` and fill it in — env values are used as defaults when no setting is saved. Both `SEEDBOX_*` and the older `WHATBOX_*` names are accepted.

| Setting | Env var | Notes |
|---|---|---|
| Index URL | `SEEDBOX_HTTP_BASE_URL` | e.g. `https://yourbox.host/private/` |
| Username / password | `SEEDBOX_HTTP_USER` / `SEEDBOX_HTTP_PASS` | HTTP Basic auth |
| Movie / series folders | `MOVIE_DIRS` / `SERIES_DIRS` | comma-separated, default `Movies` / `TV Shows` |
| TMDB key | `TMDB_API_KEY` | required |
| Gemini key / model | `GEMINI_API_KEY` / `GEMINI_MODEL` | optional; default `gemini-flash-latest` |
| RPDB key | `RPDB_API_KEY` | optional |
| Poster source | `POSTER_SOURCE` | `better` (default) / `rpdb` / `tmdb` |
| Display name | `ADDON_NAME` | shown in the manifest and as the stream source |
| Public URL | `ADDON_BASE_URL` | set behind a reverse proxy / custom domain |
| Access secret | `ADDON_SECRET` | auto-generated by `/setup` if unset |
| Admin password | `ADMIN_PASSWORD` | auto-generated by `/setup` if unset |
| Data dir | `DATA_DIR` | persistent path for index + caches + settings |
| Scan interval | `SCAN_INTERVAL_MINUTES` | default `720` (12h) |
| TLS cert / key | `TLS_CERT` / `TLS_KEY` | serve HTTPS directly (or terminate TLS at a proxy) |

---

## Admin panel

At `<your-url>/<secret>/admin` (HTTP Basic — user is anything, password is your admin password):

- Library counts, matched %, last scan time, and per-language breakdown.
- Subtitle coverage and a list of **unpicked** (orphan) subtitle files.
- **Unmatched / unindexed** titles, plus a fixer to pin a TMDB id by hand.
- Skipped folders with reasons.
- **Quick rescan** (incremental) and **full rescan** (clears the match cache).
- Live settings editor.

---

## Deploying

### Docker (recommended)

`docker compose up -d` as above. State lives in `./data` (mount it to persist). To use a prebuilt image instead of building locally, uncomment the `image:` line in [`docker-compose.yml`](docker-compose.yml).

### Render

A [`render.yaml`](render.yaml) blueprint is included (web service + 1 GB persistent disk). Push to your fork, create a Blueprint on Render, and set the secret env vars in the dashboard — or leave them blank and use `/setup` after deploy. Use a paid instance type if you need it always-on.

### Any Node host / VPS

```bash
npm install
DATA_DIR=/var/lib/nuvio-seedbox node src/index.js
```

Run it behind nginx/Caddy (which can terminate TLS), or set `TLS_CERT`/`TLS_KEY` to serve HTTPS directly. Use a process manager (systemd, pm2) to keep it alive.

> **Expose it safely.** Because stream responses carry your seedbox credentials, only ever share the secret-pathed install URL, and serve over HTTPS in production.

---

## Security notes

- The access **secret** makes the install URL unguessable; without it, requests get a redirect to setup (before config) or 404 (after). Don't post the full URL publicly.
- The **admin password** is independent of the secret, so sharing an install URL never exposes admin.
- Secrets and credentials live only in `data/settings.json` (gitignored, `chmod 600` where supported) or your env — never in the repo.
- This repo ships **no** keys or credentials. `.env.example` is blank and `overrides.json` is empty.

---

## FAQ

**Will streaming be slow because of the add-on?** No — video goes straight from your seedbox to the player. The add-on only serves metadata and small subtitle files.

**Does the scan reprocess my whole library every time?** No. After the first scan, only new or removed items are touched (a persistent match cache handles the rest), so re-indexes are fast and cheap.

**How soon do new downloads appear?** At the next scheduled scan (default every 12h, configurable), or immediately if you hit **Rescan** in the admin panel.

**My folders aren't called `Movies` / `TV Shows`.** Set your folder names in `/setup` or `MOVIE_DIRS` / `SERIES_DIRS` (comma-separated for multiple).

**A title matched the wrong thing.** Open the admin panel's unmatched/fixer and pin the correct TMDB id.

---

## License

[MIT](LICENSE).

Not affiliated with Stremio or NuvioMedia.
