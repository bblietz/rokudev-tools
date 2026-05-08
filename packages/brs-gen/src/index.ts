#!/usr/bin/env node
import { runServer } from './bootstrap/index.js';
runServer().catch((e) => {
  process.stderr.write(`brs-gen failed to start: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
