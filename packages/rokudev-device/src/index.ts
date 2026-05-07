#!/usr/bin/env node
import { runServer } from './server.js';
import './tools/all.js'; // import side-effect modules that call registerToolsModule

runServer().catch((err) => {
  console.error('rokudev-device fatal error:', err);
  process.exit(1);
});
