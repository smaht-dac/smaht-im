#!/usr/bin/env node
/**
 * scripts/migrate-branches.js — ONE-TIME migration
 *
 * Moves every existing temp-local-inserts-<slug> BRANCH folder out of the
 * portal checkout (INSERTS_BASE) and into ~/.smaht-im/branches/ (BRANCHES_BASE),
 * matching where src/core.js now expects to find them. The literal working
 * copy (temp-local-inserts) is never touched — it stays inside the portal
 * checkout, since the portal/tests read it there.
 *
 * Run once, after pulling the core.js changes that introduce BRANCHES_BASE
 * and before rebuilding/running imc:
 *
 *   node scripts/migrate-branches.js
 *
 * Safe to re-run: a folder already moved (no longer present at the source)
 * is skipped; a folder whose destination already exists is left alone for
 * manual inspection rather than overwritten. Uses an atomic rename on the
 * same filesystem; falls back to copy+verify+delete only if that's not
 * possible (e.g. the two directories end up on different volumes).
 */

import fs from 'node:fs';
import path from 'node:path';
import { INSERTS_BASE, BRANCHES_BASE, INSERT_PREFIX, ACTIVE_FOLDER } from '../src/core.js';

fs.mkdirSync(BRANCHES_BASE, { recursive: true });

const candidates = fs.readdirSync(INSERTS_BASE, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith(INSERT_PREFIX) && e.name !== ACTIVE_FOLDER)
  .map(e => e.name)
  .sort();

if (candidates.length === 0) {
  console.log('No branch folders found in the portal checkout — nothing to migrate.');
  process.exit(0);
}

console.log(`Found ${candidates.length} branch folder(s) to migrate:\n`);

function listSizes(dir) {
  return fs.readdirSync(dir)
    .map(f => [f, fs.statSync(path.join(dir, f)).size])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

let moved = 0, skipped = 0, alreadyDone = 0;

for (const name of candidates) {
  const src = path.join(INSERTS_BASE, name);
  const dest = path.join(BRANCHES_BASE, name);

  if (!fs.existsSync(src) && fs.existsSync(dest)) {
    console.log(`  skip  ${name} — already migrated`);
    alreadyDone++;
    continue;
  }
  if (fs.existsSync(dest)) {
    console.log(`  SKIP  ${name} — destination already exists, not overwriting (resolve by hand)`);
    skipped++;
    continue;
  }

  try {
    fs.renameSync(src, dest);
    console.log(`  moved ${name}`);
    moved++;
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    // Cross-device fallback: copy, verify (name + size per file), then delete original.
    fs.cpSync(src, dest, { recursive: true });
    const same = JSON.stringify(listSizes(src)) === JSON.stringify(listSizes(dest));
    if (!same) {
      throw new Error(`verify failed for ${name} after cross-device copy — NOT deleting original, inspect by hand at ${src} vs ${dest}`);
    }
    fs.rmSync(src, { recursive: true, force: true });
    console.log(`  moved ${name} (cross-device copy+verify+delete)`);
    moved++;
  }
}

console.log(`\nDone — ${moved} moved, ${alreadyDone} already migrated, ${skipped} skipped (needs manual resolution).`);
console.log(`Branches now live at: ${BRANCHES_BASE}`);
if (skipped > 0) {
  console.log(`\n${skipped} folder(s) need manual attention before imc will see them correctly — see SKIP lines above.`);
  process.exit(1);
}
