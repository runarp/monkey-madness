import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleScoresApi } from './server/scores.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 3000);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
]);

const sendText = (response, statusCode, text) => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(text);
};

const resolveStaticPath = (urlPathname) => {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(distDir, `.${requestedPath}`);
  if (!filePath.startsWith(`${distDir}${path.sep}`) && filePath !== distDir) return null;
  return filePath;
};

const serveFile = async (request, response, filePath) => {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) return false;

  response.statusCode = 200;
  response.setHeader('content-length', fileStats.size);
  response.setHeader('content-type', mimeTypes.get(path.extname(filePath)) || 'application/octet-stream');
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
};

const serveStatic = async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed.');
    return;
  }

  const url = new URL(request.url || '/', 'http://localhost');
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    sendText(response, 403, 'Forbidden.');
    return;
  }

  try {
    if (await serveFile(request, response, filePath)) return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  try {
    if (await serveFile(request, response, path.join(distDir, 'index.html'))) return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  sendText(response, 404, 'Build output not found. Run `npm run build` before `npm start`.');
};

const server = http.createServer(async (request, response) => {
  try {
    if (await handleScoresApi(request, response)) return;
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendText(response, 500, 'Server error.');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Monkey Madness server listening on http://localhost:${port}`);
});
