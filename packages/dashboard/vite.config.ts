import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: false,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
    },
    proxy: {
      '/api': 'http://127.0.0.1:18800',
      '/ws': {
        target: 'ws://127.0.0.1:18800',
        ws: true,
      },
      '/health': 'http://127.0.0.1:18800',
      '/info': 'http://127.0.0.1:18800',
    },
  },
  build: {
    outDir: 'dist',
  },
});
