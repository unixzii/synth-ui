import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@synth-ui/source'] },
  ssr: { resolve: { conditions: ['@synth-ui/source'] } },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
