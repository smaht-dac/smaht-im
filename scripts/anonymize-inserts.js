#!/usr/bin/env node
/**
 * scripts/anonymize-inserts.js
 *
 * CLI wrapper around anonymizeFolder() in src/core.js — the same
 * implementation used by imc's 'e' keybinding (Export de-identified copy)
 * in the Folders panel. Use whichever entry point is more convenient;
 * both write to the same place and do the same thing.
 *
 * Produces a de-identified COPY of a temp-local-inserts* folder so it can be
 * shared outside your machine (bug reports, example data, etc.) without
 * handing over real donor/sample records.
 *
 * THIS IS A HEURISTIC TOOL, NOT A COMPLIANCE SIGN-OFF. Read the "Sharing
 * inserts data safely" section in the README before sending anything
 * anywhere. In particular:
 *   - It does not touch actual sequence/genotype data in referenced files —
 *     only the JSON insert records themselves.
 *   - Shuffling/faking fields on a handful of records does not prevent
 *     re-identification by someone who already knows something about the
 *     cohort. Small-N groups are flagged, not fixed.
 *   - The default field-name policy (ANONYMIZE_DEFAULT_POLICY in core.js)
 *     is a generic guess. You MUST review — and likely extend — it against
 *     the real SMaHT schema before trusting it for anything you plan to
 *     actually share.
 *
 * Usage:
 *   node scripts/anonymize-inserts.js <source-folder-name> [output-dir] [options]
 *
 * Options:
 *   --config=<path>   JSON file overriding ANONYMIZE_DEFAULT_POLICY
 *   --seed=<phrase>   Deterministic mode — same input + seed always produces
 *                     the same fake output (useful for reproducible fixtures).
 *                     Omit for a fresh random remap every run.
 *   --jitter-days=N   Max days to jitter date fields by (default 30)
 *
 * Example:
 *   node scripts/anonymize-inserts.js temp-local-inserts-devtest \
 *     ~/smaht-im-exports/devtest-anon --seed=ticket-1234
 *
 * If [output-dir] is omitted, output goes to a fresh timestamped directory
 * under ~/smaht-im-exports/ — outside the smaht-portal inserts directory,
 * so it's never mistaken for a working temp-local-inserts* branch.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { folderLabel, anonymizeFolder, ANONYMIZE_DEFAULT_POLICY } from '../src/core.js';

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      opts[k] = v ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [sourceName, outDirArg] = positional;

  if (!sourceName) {
    console.error('Usage: node scripts/anonymize-inserts.js <source-folder-name> [output-dir] [--seed=phrase] [--config=path] [--jitter-days=N]');
    process.exit(1);
  }

  const policy = opts.config
    ? { ...ANONYMIZE_DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(opts.config, 'utf8')) }
    : ANONYMIZE_DEFAULT_POLICY;

  const outDir = outDirArg
    ? path.resolve(outDirArg.replace(/^~(?=$|\/)/, os.homedir()))
    : undefined; // let anonymizeFolder() pick the default ~/smaht-im-exports/ path

  let outcome;
  try {
    outcome = anonymizeFolder(sourceName, {
      outDir,
      seed: opts.seed,
      jitterDays: opts['jitter-days'] ? Number(opts['jitter-days']) : undefined,
      policy,
    });
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const { outDir: finalOutDir, report } = outcome;

  console.log(`\nWrote de-identified copy of '${folderLabel(sourceName)}' to:\n  ${finalOutDir}\n`);
  console.log('Per-type summary:');
  for (const [t, r] of Object.entries(report.types)) {
    console.log(`  ${t} (${r.recordCount} records)`);
    if (r.scrubbedFields.length) console.log(`    scrubbed:  ${r.scrubbedFields.join(', ')}`);
    if (r.fakedFields.length) console.log(`    faked:     ${r.fakedFields.join(', ')}`);
    if (r.jitteredDateFields.length) console.log(`    jittered:  ${r.jitteredDateFields.join(', ')}`);
    if (r.shuffledFields.length) console.log(`    shuffled:  ${r.shuffledFields.join(', ')}`);
    if (r.shuffleSkippedTooSmall.length) {
      for (const s of r.shuffleSkippedTooSmall) {
        console.log(`    ! '${s.field}' has only ${s.count} record(s) with a value — redacted instead of shuffled (see minGroupSizeForShuffle)`);
      }
    }
  }
  console.log(`\nFull report: ${path.join(finalOutDir, '_ANONYMIZATION_REPORT.json')}`);
  console.log('\nReview the output AND the report before sharing anything. This tool applies');
  console.log('a generic heuristic policy — check it against the real schema, and remember');
  console.log('it does not touch any referenced sequence/genotype files, only these JSON records.\n');
}

main();
