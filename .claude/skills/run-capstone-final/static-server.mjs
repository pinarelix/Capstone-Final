// Minimal static file server for the frontend, on the exact port (5500)
// the backend's CORS allowlist expects (see BACKEND/server.js allowedOrigins).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] || process.cwd();
const PORT = Number(process.argv[3] || 5500);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jfif': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/') path = '/login.html';
  const filePath = normalize(join(ROOT, path));
  if (!filePath.startsWith(normalize(ROOT)) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log(`static-server: serving ${ROOT} on http://localhost:${PORT}`));
