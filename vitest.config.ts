import { defineConfig } from 'vitest/config';

// Интеграционные тесты идут по РЕАЛЬНОЙ базе, поэтому запускаем их строго
// последовательно в одном процессе: разные файлы не должны топтать данные
// друг друга, а тест конкурентности (50 параллельных запросов) должен
// владеть базой единолично.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
