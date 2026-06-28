import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend serves JSON at :3001. Proxy /api during dev so the browser stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
