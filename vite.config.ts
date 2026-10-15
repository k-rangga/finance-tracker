import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file (JS, CSS and images inlined) so Apps Script can serve it as Index.html.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
});
