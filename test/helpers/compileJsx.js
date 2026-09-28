/**
 * Compile a .jsx source file (and its local ./ imports) into a temporary
 * plain-ESM file using esbuild, then dynamically import it.
 *
 * Needed because Node's own module loader has no JSX transform, this
 * project only ever transforms JSX via esbuild, at build time, into
 * dist/imc.js (see "Build workflow" in CLAUDE.md). Component-rendering
 * tests need the REAL compiled component (ink-testing-library renders
 * actual output), not a hand-rolled reimplementation, so this reuses the
 * project's own esbuild flags (--bundle --packages=external --platform=node
 * --format=esm, matching package.json's "build" script) rather than
 * inventing a separate transform pipeline just for tests.
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Written under the project root, not os.tmpdir(): externalized packages
// (react, ink, ...) resolve via node_modules found by walking up from the
// compiled file's own location, which only works if that location is
// somewhere under this project. Gitignored; safe to leave stray copies.
const COMPILE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.compiled',
);

export async function importJsx(entryPath) {
  fs.mkdirSync(COMPILE_DIR, { recursive: true });
  // Fixed name (no per-call timestamp): each call overwrites rather than
  // accumulating stray files across repeated test runs. A dynamic import
  // of the same path is still a fresh module in a fresh process each time
  // (node --test gives every test file its own process), so there's no
  // staleness risk to guard against here, unlike core.js's real state.
  const outfile = path.join(COMPILE_DIR, `${path.basename(entryPath, path.extname(entryPath))}.mjs`);
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
  });
  return import(outfile);
}
