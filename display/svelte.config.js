import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true,
    }),
    // Emit relative asset paths so the kiosk + admin work under HA's
    // Ingress proxy (which mounts the app at a dynamic
    // /api/hassio_ingress/<token>/ path). Absolute paths break under
    // a subpath; relative paths just work.
    paths: { relative: true },
  },
};
