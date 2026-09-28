/**
 * Test isolation helpers for core.js.
 *
 * core.js resolves REPO_ROOT/INSERTS_BASE/BRANCHES_BASE/META_DIR/KEYS_FILE/etc.
 * from SMAHT_REPO_ROOT and os.homedir() into top-level `const`s at MODULE
 * EVALUATION time (see src/core.js). That means:
 *
 *   1. Env vars must be set BEFORE core.js is first imported in a process.
 *   2. Once imported, those paths are frozen for the lifetime of that process
 *      — re-setting the env vars later has no effect on an already-imported
 *      core.js.
 *
 * `node --test` runs each test *file* as its own process (verified: two test
 * files importing the same module with different env vars each see their own
 * value), so the pattern every test file in this suite follows is:
 *
 *   import { useTempEnv } from './helpers/env.js';
 *   useTempEnv();
 *   const core = await import('../src/core.js');   // dynamic — NOT hoisted,
 *                                                    // so this runs after
 *                                                    // useTempEnv() above.
 *
 * This guarantees every test run only ever touches throwaway temp
 * directories — never a real smaht-portal checkout or ~/.smaht-im — which
 * matters doubly here since real pulled inserts data may be protected
 * (see CLAUDE.md's "Data safety" section).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'bin',
);

/**
 * Point HOME and SMAHT_REPO_ROOT at fresh temp directories for this process,
 * and prepend the fake `update-inserts-from-server` (test/fixtures/bin) to
 * PATH so any spawn-based sync path in core.js hits that instead of a real
 * network call or the real CLI tool.
 */
export function useTempEnv() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-test-home-'));
  const tmpRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-test-repo-'));
  process.env.HOME = tmpHome;
  process.env.SMAHT_REPO_ROOT = tmpRepoRoot;
  process.env.PATH = `${FIXTURES_BIN}${path.delimiter}${process.env.PATH ?? ''}`;
  return { tmpHome, tmpRepoRoot };
}

/**
 * Wipe INSERTS_BASE, BRANCHES_BASE, and ~/.smaht-im back to empty. Only
 * needed by tests that exercise loadAllFolders' bootstrap/HEAD-resolution
 * logic, which cares about a genuinely clean starting state — most other
 * tests just use unique folder names instead and don't need this.
 */
export function resetInsertState(core) {
  for (const dir of [core.INSERTS_BASE, core.BRANCHES_BASE]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.rmSync(path.join(os.homedir(), '.smaht-im'), { recursive: true, force: true });
}

/** Write {type: [items]} as `<dirPath>/<type>.json` for each entry. */
export function writeFolderFiles(dirPath, filesByType) {
  fs.mkdirSync(dirPath, { recursive: true });
  for (const [type, items] of Object.entries(filesByType)) {
    fs.writeFileSync(path.join(dirPath, `${type}.json`), JSON.stringify(items));
  }
}
