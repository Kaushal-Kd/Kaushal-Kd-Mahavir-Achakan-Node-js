import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopDir = fileURLToPath(new URL('.', import.meta.url));
const sharedSrc = path.resolve(desktopDir, '../../packages/shared/src');

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // Directory alias so @wrs/shared/constants, /utils, /schemas resolve correctly.
      { find: '@wrs/shared', replacement: sharedSrc },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    // Local workspace package — pre-bundling caches exports and breaks after shared adds new symbols.
    exclude: ['@wrs/shared'],
    include: ['jspdf', 'jspdf-autotable', 'html2canvas'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: [
            'react',
            'react-dom',
            'react-router-dom',
            '@tanstack/react-query',
            'zustand',
          ],
          icons: ['lucide-react'],
          http: ['axios'],
        },
      },
    },
  },
});
