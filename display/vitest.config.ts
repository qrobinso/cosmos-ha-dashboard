import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // The svelte plugin lets tests mount real components rather than only plain
  // modules. `hot: false` keeps the compiled output plain client-side Svelte.
  plugins: [svelte({ hot: false })],
  resolve: {
    // Match SvelteKit's `$lib` alias so components' own imports resolve.
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
    // Without this Vite hands tests the SSR build of Svelte, which cannot
    // mount into a jsdom DOM.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
  },
});
