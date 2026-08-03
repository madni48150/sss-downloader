# SSS Downloader

Free video downloader for YouTube, Instagram, Facebook, TikTok, X, Pinterest, Snapchat and LinkedIn.
Frontend + API in one small service. No npm dependencies.

## Deploy on Render

1. **New → Web Service** → pick this repo
2. **Runtime:** Docker (Render finds the root `Dockerfile` automatically)
3. **Instance Type:** Free
4. **Create Web Service**, wait ~4 minutes
5. Open the `https://…onrender.com` URL — done

## Run locally

```bash
node server.js
```

Requires Node 18+, plus `yt-dlp` and `ffmpeg` on PATH. Then open http://localhost:8080.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /` | the web UI |
| `GET /health` | `{ "ok": true }` |
| `GET /api/info?url=…` | title, thumbnail, duration, available formats |
| `GET /api/download?url=…&format=1080p\|720p\|480p\|mp3` | streams the file |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | listen port |
| `YTDLP_PATH` | `yt-dlp` | full path to yt-dlp if not on PATH |
| `CORS_ORIGIN` | `*` | allowed origin |
| `MAX_DURATION_SECONDS` | `5400` | reject videos longer than this |

## Notes

- **Keep yt-dlp fresh.** Platforms change constantly; redeploy periodically so the image picks up the latest yt-dlp.
- **Cloud IPs get blocked.** YouTube in particular often rejects datacenter IPs with "Sign in to confirm you're not a bot". Other platforms are usually fine.
- Free Render instances sleep after 15 minutes idle; the first request afterwards takes 30-60 seconds.

## Disclaimer

Personal use only. Downloading copyrighted content is the user's own responsibility and may violate the source platform's Terms of Service. This service does not host or store any media.
