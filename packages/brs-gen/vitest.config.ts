import { defineConfig } from 'vitest/config';
import base from '../../vitest.config.base.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
    // TZ=UTC: yazl encodes zip mtimes in local time; goldens are generated
    // with TZ=UTC so tests must also run under UTC for byte-equality to hold.
    forkOptions: { env: { TZ: 'UTC' } },
    // Disable shuffle so generate-app.test.ts beforeAll/afterAll fixture
    // lifecycle (templates/template-with-static-branding-default) does not
    // pollute catalog-loading tests that run concurrently.
    sequence: { shuffle: false },
  },
});
