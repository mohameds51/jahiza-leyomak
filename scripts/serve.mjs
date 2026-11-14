// خادم محلي بسيط للمعاينة: يخدم dist/ مع روابط نظيفة (/privacy) ويشغّل api/lead.js كما تفعل Vercel.
// الاستخدام: npm run build && npm run serve   ثم افتح http://localhost:4173

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4173);

for (const name of ['.env.local', '.env']) {
  const p = join(ROOT, name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

async function runApi(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
  const mod = await import(pathToFileURL(join(ROOT, 'api', 'lead.js')).href);
  return mod.default(req, res);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/lead') return await runApi(req, res);

    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = normalize(join(DIST, p));
    if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end('Forbidden'); }
    if (!extname(file) && existsSync(file + '.html')) file += '.html';
    if (!existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }

    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Server error');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
