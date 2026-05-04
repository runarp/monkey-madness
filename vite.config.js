import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { handleScoresApi } from './server/scores.mjs';

const readGitValue = (command, fallback = 'unknown') => {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
};

const appVersion = {
  commitRef: readGitValue('git rev-parse --short=8 HEAD'),
  commitDate: readGitValue('git log -1 --format=%cI', ''),
  buildTime: new Date().toISOString(),
};

const scoresApiPlugin = () => ({
  name: 'monkey-madness-scores-api',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      try {
        if (await handleScoresApi(request, response)) return;
        next();
      } catch (error) {
        next(error);
      }
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use(async (request, response, next) => {
      try {
        if (await handleScoresApi(request, response)) return;
        next();
      } catch (error) {
        next(error);
      }
    });
  },
});

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [scoresApiPlugin(), react()],
});
