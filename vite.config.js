import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 4173
  }
  ,
  build: {
    sourcemap: false,
    // increase chunk warning limit to avoid noisy warnings during build
    chunkSizeWarningLimit: 1000,
    // use esbuild minifier (default) to keep build simple
    minify: 'esbuild'
  }
});
