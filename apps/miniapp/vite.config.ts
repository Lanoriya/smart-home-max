import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The mini-app is served under /app/ of the same domain as the API, so it
// needs no CORS and MAX opens it by one HTTPS address.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': process.env.MINIAPP_API_TARGET ?? 'http://localhost:3000',
    },
  },
});
