import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js') || id.includes('node_modules/@pixi/')) return 'pixi';
          if (id.includes('node_modules/@esotericsoftware')) return 'spine-core';
        },
      },
    },
  },
  server: { port: 5173 },
});
