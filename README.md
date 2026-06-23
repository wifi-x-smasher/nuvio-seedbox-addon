# nuvio-seedbox-addon

A self-hosted [Stremio](https://www.stremio.com/) / [Nuvio](https://github.com/NuvioMedia) add-on that turns **your own seedbox** into a beautiful media library inside your player — with posters, ratings, cast, **direct streaming**, and **subtitles**. You set it up entirely in your browser; no coding.

Point it at any seedbox that serves an HTTP file index (the classic *"Index of /…"* page) with a username/password. It scans your library, looks up each title on TMDB, and shows it to your player. Video streams **straight from your seedbox to your player**, so it stays fast.

> **Your stuff stays yours.** Your seedbox address, login, and API keys live only in your own copy (`data/settings.json`, never uploaded). Nothing is shared with anyone.

---

## What it looks like

Once it's set up, your library appears in Nuvio/Stremio as tidy rows by language, with full posters and ratings:

![Seedbox library catalogs shown in Nuvio](docs/preview.png)

---

## Features

- 📚 **Catalogs** for movies and series, with series grouped by language: **English / Korean / Chinese / Japanese / Thai / Others**.
- ▶️ **Direct streaming** — your player downloads from your seedbox directly; the add-on never sits in the middle of your video.
- 💬 **Subtitles** — sidecar `.srt` / `.ass` / `.ssa` files are matched and served automatically.
- 🖼️ **Rich details** — posters, cast, ratings, runtime, trailers, logos, and per-episode thumbnails/summaries.
- 🔁 **Stays up to date** — re-scans on a schedule and only processes what changed, so new downloads show up on their own.
- 🛠️ **Admin panel** — see library health, fix mismatched titles, and change settings from a web page.
- 🔒 **Private by default** — a secret link keeps your library unguessable; a separate password protects the admin panel.

---

## Get started

There are just **two things to do**: (1) grab a free TMDB key, then (2) run the add-on somewhere. Pick the "somewhere" that matches what you have — each option below is a complete, click-by-click walkthrough.

### Step 1 — Get a free TMDB API key (everyone needs this)

TMDB provides the posters, titles, and episode info. It's free.

1. Go to **https://www.themoviedb.org/signup** and create an account (confirm via the email they send).
2. Open **https://www.themoviedb.org/settings/api**.
3. Click **Create** → choose **Developer** → accept the terms.
4. Fill in the short form (for "Application Name" put anything like `My Seedbox`, for URL put `http://localhost`, fill the rest with anything reasonable) and submit.
5. Copy the long string labelled **"API Key (v3 auth)"**. Keep it handy — you'll paste it during setup.

### Step 2 — Choose where to run it

The add-on is a small always-on program. Where you run it decides whether you can use it **only at home** or **anywhere (including your phone on mobile data)**.

| Where you run it | Good if you have… | Works away from home? |
|---|---|---|
| **On your seedbox** (Option C) | a seedbox that allows SSH | ✅ Yes, automatically |
| **Free cloud — Render** (Option D) | no spare computer | ✅ Yes, automatically |
| **A home mini PC / Mac mini / Raspberry Pi** (Option B) | a device you leave on 24/7 | ⚠️ Needs one extra step (see [Using it away from home](#using-it-away-from-home)) |
| **Your everyday laptop** (Option A) | just a laptop, want to try it | ⚠️ Only while the laptop is on; away-from-home needs the extra step |

**Not sure?** If your seedbox lets you SSH in, use **Option C** — it's already online 24/7. No spare computer at all? Use **Option D (Render)**.

Now jump to your option:

---

<details>
<summary><b>Option A — Your laptop or desktop (Windows or Mac) — easiest way to try it</b></summary>

<br>

**Windows:**

1. **Install Node.js.** Go to **https://nodejs.org**, click the big **LTS** download, run the installer, and click *Next* through to *Finish* (defaults are fine).
2. **Download the add-on.** On this GitHub page click the green **`< > Code`** button → **Download ZIP**. Then right-click the downloaded file → **Extract All**. You'll get a folder called `nuvio-seedbox-addon`.
3. **Open a terminal in that folder.** Open the extracted folder, click in the address bar at the top, type `powershell`, and press Enter. A blue/black window opens.
4. **Start it.** Type these two lines, pressing Enter after each (the first one takes a minute):
   ```
   npm install
   npm start
   ```
   When you see `…add-on running on port 7700`, it's working. **Leave this window open** — closing it stops the add-on.
5. **Set it up.** Open your browser to **http://localhost:7700/setup** and follow [Step 3](#step-3--finish-setup-in-your-browser).

**Mac (MacBook, iMac, Mac mini):**

1. **Install Node.js.** Go to **https://nodejs.org**, download the **LTS** `.pkg`, open it, and click through the installer.
2. **Download the add-on.** Click the green **`< > Code`** button → **Download ZIP**, then double-click the ZIP to unzip it. You get a `nuvio-seedbox-addon` folder.
3. **Open Terminal in that folder.** Open the **Terminal** app, type `cd ` (with a space), then drag the unzipped folder onto the Terminal window and press Enter.
4. **Start it.** Run these two commands (first one takes a minute):
   ```
   npm install
   npm start
   ```
   When you see `…add-on running on port 7700`, leave the Terminal window open.
5. **Set it up.** Open **http://localhost:7700/setup** and follow [Step 3](#step-3--finish-setup-in-your-browser).

> This works great for a player **on the same computer or home Wi-Fi**. To use it on your phone away from home, see [Using it away from home](#using-it-away-from-home).

</details>

<details>
<summary><b>Option B — An always-on home device (Mac mini, mini PC, Raspberry Pi, home server)</b></summary>

<br>

This is like Option A, but you also make it **start automatically and keep running** so you don't have to leave a terminal open.

1. **Install Node.js** on the device (see Option A for your OS, or on Linux: `sudo apt install nodejs npm`).
2. **Download the add-on:**
   ```
   git clone https://github.com/wifi-x-smasher/nuvio-seedbox-addon.git
   cd nuvio-seedbox-addon
   npm install
   ```
   (No `git`? Use the **Download ZIP** method from Option A instead.)
3. **Keep it running with pm2** (a tiny tool that restarts the app and survives reboots):
   ```
   npm install -g pm2
   pm2 start src/index.js --name seedbox-addon
   pm2 save
   pm2 startup        # then run the one command it prints, to enable auto-start on boot
   ```
4. **Set it up.** On that device open **http://localhost:7700/setup**, or from another computer on the same network use **http://DEVICE-IP:7700/setup** (find the device's IP in its network settings). Follow [Step 3](#step-3--finish-setup-in-your-browser).
   - When setup asks for the **Public URL**, enter `http://DEVICE-IP:7700` so other devices on your network can reach it.

> Want it on your phone when you're out? See [Using it away from home](#using-it-away-from-home) — Tailscale is the easiest.

</details>

<details>
<summary><b>Option C — On your seedbox (recommended: it's already online 24/7)</b></summary>

<br>

If your seedbox lets you log in over **SSH** and run Node.js, this is the best home for the add-on — it's always on and reachable from anywhere with no extra steps. (This is how the author runs it on Whatbox.)

1. **SSH into your seedbox** (your provider's panel shows the host/username, e.g. `ssh you@yourbox.host`).
2. **Check Node.js is available:**
   ```
   node -v
   ```
   - If you see a version number ≥ 18, great.
   - If not, install it just for your account with nvm:
     ```
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
     source ~/.bashrc
     nvm install 20
     ```
3. **Download and install the add-on:**
   ```
   git clone https://github.com/wifi-x-smasher/nuvio-seedbox-addon.git
   cd nuvio-seedbox-addon
   npm install
   ```
4. **Pick a port your seedbox allows.** Most seedboxes give you specific open ports — check your provider's docs/panel (e.g. Whatbox assigns ports). Use that number below in place of `PORT`.
5. **Keep it running** (so it survives you logging out) with pm2:
   ```
   npm install -g pm2
   ADDON_PORT=PORT pm2 start src/index.js --name seedbox-addon
   pm2 save
   ```
   If your seedbox doesn't allow pm2, use `screen` or `tmux` instead, or ask your provider how they keep long-running scripts alive (some use a cron keep-alive).
6. **Set it up.** Open **http://YOUR-SEEDBOX-HOST:PORT/setup** in your browser and follow [Step 3](#step-3--finish-setup-in-your-browser). For the **Public URL**, enter that same `http(s)://YOUR-SEEDBOX-HOST:PORT`.

> Many seedboxes can also give you HTTPS on a subdomain — if so, use the `https://…` address. Otherwise plain `http://host:port` works fine.

</details>

<details>
<summary><b>Option D — Free cloud hosting with Render (no computer of your own needed)</b></summary>

<br>

Runs in the cloud, online 24/7, reachable from anywhere — no hardware required.

1. **Fork this repo** (top-right **Fork** button on this GitHub page) so it's under your own account.
2. Create a free account at **https://render.com** and connect your GitHub.
3. In Render, click **New → Blueprint**, pick your forked repo, and confirm. Render reads the included `render.yaml` and sets up the service + storage for you.
4. Wait for it to deploy (a few minutes). Render gives you a public address like `https://your-app.onrender.com`.
5. **Set it up.** Open `https://your-app.onrender.com/setup` and follow [Step 3](#step-3--finish-setup-in-your-browser). Leave the **Public URL** blank — it's detected automatically.

> Render's free tier may sleep when idle and take a few seconds to wake. For always-instant playback, choose a small paid instance in Render (optional).

</details>

<details>
<summary><b>Option E — Docker (any computer or server, if you know Docker)</b></summary>

<br>

```bash
git clone https://github.com/wifi-x-smasher/nuvio-seedbox-addon.git
cd nuvio-seedbox-addon
docker compose up -d
```

Then open **http://localhost:7700/setup** (or `http://HOST-IP:7700/setup`) and follow [Step 3](#step-3--finish-setup-in-your-browser). Your settings persist in the `./data` folder. To use a prebuilt image instead of building, uncomment the `image:` line in `docker-compose.yml`.

</details>

---

### Step 3 — Finish setup in your browser

When you open `…/setup`, you'll see a simple form:

1. **Seedbox connection** — paste your seedbox **index URL** (e.g. `https://yourbox.host/private/`) and your **username/password**. Click **Test connection**: it confirms the add-on can reach your seedbox and finds your `Movies` and `TV Shows` folders. (Different folder names? Type yours in the boxes, comma-separated.)
2. **Metadata** — paste your **TMDB key** from Step 1. (Gemini and RPDB keys are optional bonuses — leave blank if you don't have them.)
3. **This add-on** — give it a **display name** (e.g. "My Library"). Leave **Public URL** as suggested unless your option above told you to set it.
4. Click **Save & start**. The add-on:
   - generates a secret **install link** and an **admin password** (it shows the password **once — copy it now**),
   - and begins its first library scan (can take a few minutes the first time).

### Step 4 — Add it to Nuvio / Stremio

Copy the **install URL** the setup page gives you, then in your player:

- **Nuvio:** Add-ons → **Install via URL** → paste → Install.
- **Stremio:** Add-ons → paste the URL in the search box → Install.

Your library rows (Movies, English, Korean, …) appear once the first scan finishes. 🎉

---

## Using it away from home

Skip this if you run on your **seedbox** (Option C) or **Render** (Option D) — those are already reachable from anywhere.

If you run on a **home device or laptop**, its address (`localhost` / `192.168.x.x`) only works on your home network. To use the add-on on your phone over mobile data, pick one:

- **Tailscale (easiest):** install the free [Tailscale](https://tailscale.com) app on both the host device and your phone, sign in with the same account on both. Then use the host's Tailscale address (e.g. `http://100.x.x.x:7700`) as the Public URL during setup. No router changes needed.
- **Cloudflare Tunnel:** a free [tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) that gives you a public `https://…` address pointing at your home device.
- **Router port-forwarding:** advanced; forward the port on your router. Only do this if you understand the security trade-offs, and always keep the secret link private.

---

## Managing your library (admin panel)

Open the **admin link** from the setup page (it's your install link with `/admin` on the end). Log in with any username and the **admin password** you saved. There you can:

- see library counts, how many titles matched, last scan time, and language breakdown;
- check subtitle coverage and spot leftover/orphan subtitle files;
- find titles that didn't match and **pin the correct one** by TMDB id;
- run a **quick rescan** (new stuff only) or a **full rescan**;
- change any setting (keys, folders, poster style, scan interval) live — no restart.

---

## Advanced configuration (optional)

You never *need* to touch these — `/setup` and the admin panel cover everything. But if you prefer environment variables (e.g. for Docker or immutable deploys), copy [`.env.example`](.env.example) to `.env`. Both `SEEDBOX_*` and the older `WHATBOX_*` names are accepted.

| Setting | Env var | Notes |
|---|---|---|
| Index URL | `SEEDBOX_HTTP_BASE_URL` | e.g. `https://yourbox.host/private/` |
| Username / password | `SEEDBOX_HTTP_USER` / `SEEDBOX_HTTP_PASS` | HTTP Basic auth |
| Movie / series folders | `MOVIE_DIRS` / `SERIES_DIRS` | comma-separated, default `Movies` / `TV Shows` |
| TMDB key | `TMDB_API_KEY` | required |
| Gemini key / model | `GEMINI_API_KEY` / `GEMINI_MODEL` | optional; default `gemini-flash-latest` |
| RPDB key | `RPDB_API_KEY` | optional |
| Poster source | `POSTER_SOURCE` | `better` (default) / `rpdb` / `tmdb` |
| Display name | `ADDON_NAME` | shown in the player and as the stream source |
| Public URL | `ADDON_BASE_URL` | set behind a reverse proxy / custom domain |
| Access secret | `ADDON_SECRET` | auto-generated by `/setup` if unset |
| Admin password | `ADMIN_PASSWORD` | auto-generated by `/setup` if unset |
| Data dir | `DATA_DIR` | persistent path for index + caches + settings |
| Scan interval | `SCAN_INTERVAL_MINUTES` | default `720` (12h) |
| TLS cert / key | `TLS_CERT` / `TLS_KEY` | serve HTTPS directly (or terminate TLS at a proxy) |

---

## How it works

```
 Nuvio / Stremio  ──asks for library/details──▶  add-on  ──reads index + TMDB──▶  metadata
        │                                           │
        └──────── plays stream URL (+ your login) ──┴──────────▶  your seedbox (direct)
```

The add-on never carries your video. It hands the player a direct seedbox link plus your login header, so playback is as fast as your seedbox. Only subtitles pass through the add-on (the subtitle format can't carry a login), and those are tiny.

---

## Security notes

- The **secret link** makes your install URL unguessable. Don't post the full link publicly.
- The **admin password** is separate from the secret link, so sharing the install link never exposes admin.
- Your keys and seedbox login live only in `data/settings.json` (never uploaded) or your own env — never in this repo.
- This repo ships **no** keys or credentials. `.env.example` is blank and `overrides.json` is empty.

---

## FAQ

**Will the add-on slow down my streams?** No — video goes straight from your seedbox to your player. The add-on only handles small metadata and subtitle files.

**Does it re-scan everything every time?** No. After the first scan it only touches new or removed items, so updates are quick.

**How soon do new downloads appear?** At the next scheduled scan (default every 12h, adjustable), or right away if you click **Rescan** in the admin panel.

**My folders aren't called `Movies` / `TV Shows`.** Type your folder names on the setup page (comma-separated for several).

**A title matched the wrong thing.** Use the admin panel to pin the correct TMDB id.

**Do I need to keep my computer on?** Only if you run it on your own computer (Options A/B). On your seedbox or Render it stays online by itself.

---

## License

[MIT](LICENSE). Not affiliated with Stremio or NuvioMedia.
