import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function getEnvInt(key: string, fallback: number): number {
  const val = process.env[key] || String(fallback);
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

const VITE_DEV_PORT = getEnvInt('VITE_DEV_PORT', 3000);
const API_PORT = getEnvInt('SERVER_PORT', 3001);
const API_HOST = getEnv('API_HOST', 'localhost');

export default defineConfig(() => {
    return {
      server: {
        port: VITE_DEV_PORT,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: `http://${API_HOST}:${API_PORT}`,
            changeOrigin: true,
          },
        },
      },
      preview: {
        port: VITE_DEV_PORT + 5,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: `http://${API_HOST}:${API_PORT}`,
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      // @ffmpeg/ffmpeg 的 ESM worker 与 Vite 预构建不兼容，需排除以免 worker 加载失败
      optimizeDeps: {
        exclude: ['@ffmpeg/ffmpeg'],
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
