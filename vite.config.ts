import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file (JS, CSS and images inlined) so Apps Script can serve it as Index.html.
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    // Tab icon for `npm run dev` only; the deployed app gets it from setFaviconUrl in apps-script/Code.js.
    { name: 'dev-favicon', apply: 'serve', transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: '/assets/favicon.png' }, injectTo: 'head' }] },
  ],
  base: './',
});
