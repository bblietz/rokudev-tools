import { defineConfig } from 'vitest/config';
import base from '../../vitest.config.base.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
  },
});
