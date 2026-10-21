import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'desktop-content-security-policy',
      apply: 'build',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content:
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  ],
  base: './',
  build: { target: 'es2022', sourcemap: false },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@project/shared-api': path.resolve(__dirname, '../../packages/shared-api/src/index.ts'),
    },
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
  server: {
    port: 5173,
  },
});
