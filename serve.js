// Zero-dependency static server. ES modules are blocked over file:// by CORS,
// so the page has to be served over http. Run: node serve.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const PORT = process.env.PORT || 5173;
const ROOT = import.meta.dirname;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glsl': 'text/plain', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';

  // Keep requests inside ROOT
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`The Valley — http://localhost:${PORT}`));
