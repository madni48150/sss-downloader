/**
 * SSS Downloader — zero-dependency backend
 * -------------------------------------------------------------
 * Same API as server.js but uses ONLY Node built-ins.
 * No npm install needed:   node server-nodeps.js
 *
 * Bonus: it also serves index.html, so frontend + API run on one
 * origin and you do NOT need to edit API_BASE at all.
 *
 * Still requires yt-dlp (and ffmpeg for 1080p/mp3) on your PATH.
 */

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT     = Number(process.env.PORT || 8080);
const YTDLP    = process.env.YTDLP_PATH || 'yt-dlp';
const MAX_SECS = Number(process.env.MAX_DURATION_SECONDS || 5400);

/* ── platforms ───────────────────────────────────────────────── */
const PLATFORMS = [
  ['youtube',   /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i],
  ['instagram', /^(www\.)?instagram\.com$/i],
  ['facebook',  /^(www\.|web\.|m\.)?(facebook\.com|fb\.watch)$/i],
  ['tiktok',    /^(www\.|vm\.|vt\.)?tiktok\.com$/i],
  ['twitter',   /^(www\.|mobile\.)?(twitter\.com|x\.com)$/i],
  ['pinterest', /^(www\.|[a-z]{2}\.)?(pinterest\.[a-z.]+|pin\.it)$/i],
  ['snapchat',  /^(www\.)?snapchat\.com$/i],
  ['linkedin',  /^(www\.)?linkedin\.com$/i],
];

function classify(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: 'INVALID_URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { error: 'INVALID_URL' };
  const hit = PLATFORMS.find(([, re]) => re.test(u.hostname));
  if (!hit) return { error: 'UNSUPPORTED_PLATFORM' };
  return { platform: hit[0], url: u.toString() };
}

const FORMATS = {
  '1080p': { label: 'MP4 · 1080p',    ext: 'mp4', sel: 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]' },
  '720p':  { label: 'MP4 · 720p',     ext: 'mp4', sel: 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]'   },
  '480p':  { label: 'MP4 · 480p',     ext: 'mp4', sel: 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]'   },
  'mp3':   { label: 'MP3 · 320kbps',  ext: 'mp3', sel: 'ba/b', audio: true },
};

/* ── tiny helpers ────────────────────────────────────────────── */
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Cache-Control': 'no-store',
  });
  res.end(s);
};

// naive per-IP rate limit: 20 requests / minute
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const win = hits.get(ip)?.filter(t => now - t < 60_000) ?? [];
  win.push(now); hits.set(ip, win);
  if (hits.size > 5000) hits.clear();
  return win.length > 20;
}

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
               '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' };

/* ── handlers ────────────────────────────────────────────────── */
async function handleInfo(res, rawUrl) {
  const c = classify(rawUrl || '');
  if (c.error === 'INVALID_URL')          return json(res, 400, { error: 'That doesn’t look like a valid URL.' });
  if (c.error === 'UNSUPPORTED_PLATFORM') return json(res, 400, { error: 'This platform isn’t supported yet.' });

  try {
    const { stdout } = await execFileP(
      YTDLP, ['--dump-single-json', '--no-warnings', '--no-playlist', '--no-progress', c.url],
      { maxBuffer: 32 * 1024 * 1024, timeout: 45_000 }
    );
    const m = JSON.parse(stdout);
    if (m.is_live) return json(res, 400, { error: 'Live streams can’t be downloaded.' });
    if (m.duration && m.duration > MAX_SECS)
      return json(res, 400, { error: `Video is too long (limit ${Math.round(MAX_SECS / 60)} minutes).` });

    const heights = new Set((m.formats || []).map(f => f.height).filter(Boolean));
    const avail = k => k === 'mp3' || [...heights].some(h => h >= parseInt(k) - 80);
    const rate = { '1080p': 3.6, '720p': 1.8, '480p': 0.9, 'mp3': 0.32 };
    const est = k => m.duration ? `${Math.max(1, Math.round(m.duration / 10 * rate[k]))} MB` : null;

    json(res, 200, {
      platform: c.platform,
      title: m.title || 'Untitled video',
      author: m.uploader || m.channel || null,
      duration: m.duration || 0,
      thumbnail: m.thumbnail || (m.thumbnails?.at(-1)?.url ?? null),
      formats: Object.entries(FORMATS).filter(([k]) => avail(k)).map(([id, f]) => ({
        id, label: f.label, ext: f.ext, audio: !!f.audio, best: id === '1080p',
        note: f.audio ? 'Audio only' : 'Video + audio', size: est(id),
      })),
    });
  } catch (err) {
    const msg = String(err.stderr || err.message || '');
    if (err.code === 'ENOENT')
      return json(res, 500, { error: 'yt-dlp not found. Install it and make sure it is on your PATH.' });
    if (/private|login|sign in|cookies/i.test(msg))
      return json(res, 403, { error: 'This video is private or requires a login.' });
    if (/unavailable|not exist|404/i.test(msg))
      return json(res, 404, { error: 'Video not found or removed.' });
    console.error('[info]', msg.slice(0, 400));
    json(res, 502, { error: 'Could not read this video. Please try another link.' });
  }
}

function handleDownload(req, res, params) {
  const c = classify(params.get('url') || '');
  if (c.error) return json(res, 400, { error: 'Invalid or unsupported link.' });

  const f = FORMATS[params.get('format') || '720p'];
  if (!f) return json(res, 400, { error: 'Unknown format.' });

  const safe = (params.get('filename') || 'video').replace(/[^\w\s.-]/g, '').trim().slice(0, 80) || 'video';
  const args = f.audio
    ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
    : ['-f', f.sel, '--merge-output-format', 'mp4'];

  const child = spawn(YTDLP, [...args, '--no-playlist', '--no-warnings', '--no-progress', '-o', '-', c.url],
    { stdio: ['ignore', 'pipe', 'pipe'] });

  let started = false, errBuf = '';
  child.stderr.on('data', d => { errBuf += d.toString().slice(0, 2000); });

  child.stdout.once('data', chunk => {
    started = true;
    res.writeHead(200, {
      'Content-Type': f.audio ? 'audio/mpeg' : 'video/mp4',
      'Content-Disposition': `attachment; filename="${safe}.${f.ext}"`,
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Cache-Control': 'no-store',
    });
    res.write(chunk);
    child.stdout.pipe(res);
  });

  child.on('error', err => {
    if (!started) json(res, 500, {
      error: err.code === 'ENOENT' ? 'yt-dlp not found. Install it and add it to your PATH.' : 'Could not start yt-dlp.'
    });
  });

  child.on('close', code => {
    if (code !== 0 && !started) {
      console.error('[download]', errBuf.slice(0, 400));
      json(res, 502, { error: 'Download failed. Try a different quality.' });
    } else if (!res.writableEnded) res.end();
  });

  req.on('close', () => { if (!child.killed) child.kill('SIGKILL'); });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  // look next to server file, then one level up (repo root)
  const candidates = [path.join(__dirname, rel), path.join(__dirname, '..', rel)];
  const file = candidates.find(p => p.startsWith(path.dirname(__dirname)) && fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/* ── server ──────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  if (pathname === '/health') return json(res, 200, { ok: true, ytdlp: YTDLP });

  if (pathname.startsWith('/api/')) {
    const ip = req.socket.remoteAddress || 'unknown';
    if (limited(ip)) return json(res, 429, { error: 'Too many requests. Wait a minute and try again.' });
    if (pathname === '/api/info')     return handleInfo(res, searchParams.get('url'));
    if (pathname === '/api/download') return handleDownload(req, res, searchParams);
    return json(res, 404, { error: 'Unknown endpoint' });
  }

  if (req.method === 'GET') return serveStatic(res, pathname);
  json(res, 404, { error: 'Not found' });
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SSS Downloader running`);
  console.log(`    this computer → http://localhost:${PORT}`);
  for (const ip of lanAddresses())
    console.log(`    phone / same WiFi → http://${ip}:${PORT}`);
  console.log('');
  execFile(YTDLP, ['--version'], (e, out) => {
    console.log(e ? '  ⚠ yt-dlp NOT found on PATH — install it, downloads will fail until you do.'
                  : `  ✓ yt-dlp ${String(out).trim()}`);
    execFile('ffmpeg', ['-version'], e2 => {
      console.log(e2 ? '  ⚠ ffmpeg NOT found — 1080p merge and MP3 will fail.\n' : '  ✓ ffmpeg found\n');
    });
  });
});
