import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // NEXT_PUBLIC_* is how the Vercel Supabase integration names its browser-safe vars.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
