import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    // 测试根目录：src 与 components 都覆盖
    include: [
      'tests/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'services/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      'node_modules',
      'dist',
      'release',
      '**/*.e2e.test.ts',
    ],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'components/StageDirector/utils.ts',
        'components/StageDirector/cameraMovementGuides.ts',
      ],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
  },
});