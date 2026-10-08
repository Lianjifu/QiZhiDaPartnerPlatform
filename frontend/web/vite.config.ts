import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'web/src');
const PKG = (p: string) => path.join(ROOT, 'packages', p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: SRC },
      { find: '@qzda/web-ui', replacement: PKG('ui/src/index.tsx') },
      { find: '@qzda/web-api', replacement: PKG('api/src/index.ts') },
      { find: '@qzda/web-types', replacement: PKG('types/src/index.ts') },
      { find: '@qzda/web-hooks', replacement: PKG('hooks/src/index.ts') },
      { find: '@qzda/web-utils', replacement: PKG('utils/src/index.ts') },
    ],
  },
  server: {
    host: true,
    port: 8010,
    strictPort: false,
    // 联调：VITE_API_BASE 为空时，浏览器走同源 /api，由此代理到粗粒度网关
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8089',
        changeOrigin: true,
        secure: false,
      },
      '/healthz': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8089',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: { host: true, port: 8011 },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'zustand',
      'lucide-react',
      'reactflow',
    ],
  },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'jsdom' },
});
