import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      RESIDENT_UK_CODE: '0000000000',
    },
  },
});
