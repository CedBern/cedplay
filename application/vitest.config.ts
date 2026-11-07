import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Les tests lents (catalogues de 150 titres, IndexedDB) dépassent 5 s quand la
    // suite tourne en parallèle avec la couverture — un timeout court fabrique des
    // échecs aléatoires, pas des défauts.
    testTimeout: 15000,
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
