import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const addonConfig = readFileSync(resolve(here, '../addon/config.yaml'), 'utf8');
const versionMatch = addonConfig.match(/^version:\s*"?([^"\n]+)"?/m);
const cosmosVersion = versionMatch ? versionMatch[1].trim() : 'unknown';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __COSMOS_VERSION__: JSON.stringify(cosmosVersion),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8099',
      '/ws': { target: 'ws://localhost:8099', ws: true },
    },
  },
});
