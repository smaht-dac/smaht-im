#!/usr/bin/env node
/**
 * bin/imc.js — thin launcher for the built TUI.
 *
 * After running `npm run build`, you can also symlink or copy this to a
 * directory on your PATH, or use the alias:
 *   alias imc='node ~/smaht-im/dist/imc.js'
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distFile = join(__dirname, '..', 'dist', 'imc.js');

if (!existsSync(distFile)) {
  console.error('\nError: dist/imc.js not found. Run:  npm run build\n');
  process.exit(1);
}

// Dynamic import so this script works even before the build
await import(distFile);
