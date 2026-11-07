import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/utils/**', 'src/hooks/**'],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 70,
        statements: 80
      }
    }
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } }
});
