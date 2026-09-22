/**
 * Local preview, no Vercel needed:
 *
 *   npm run local
 *   then open  http://localhost:3789/#k=<your TEAM_KEY>
 *
 * Settings are read from .env (copy .env.example). This reproduces just enough
 * of Vercel: the static page, /api/callers, and res.status().json().
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import callers from '../api/callers.js';

const PORT = Number(process.env.PORT || 3789);
const pub = new URL('../public/', import.meta.url);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

createServer(async (req, res) => {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  let path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/callers') return callers(req, res);
  if (path === '/' || path === '/callers') path = '/callers.html';
  const ext = extname(path);
  if (TYPES[ext] && /^\/[\w.-]+$/.test(path)) {
    try {
      const body = await readFile(new URL('.' + path, pub));
      res.setHeader('content-type', TYPES[ext]);
      res.setHeader('cache-control', 'no-store');
      return res.end(body);
    } catch {}
  }
  res.statusCode = 404; res.end('404');
}).listen(PORT, '0.0.0.0', () => console.log(`\n  Preview: http://localhost:${PORT}/#k=<your TEAM_KEY>\n`));
