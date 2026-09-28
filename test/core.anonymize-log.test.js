import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useTempEnv, writeFolderFiles } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

describe('anonymizeFolder', () => {
  test('remaps UUIDs consistently across files, preserving referential integrity', () => {
    const full = core.createFolder('anon-a');
    const donorUuid = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [{ uuid: donorUuid, submitted_id: 'REAL-ID-1', age: 42 }],
      tissue: [{ uuid: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb', donor: donorUuid }],
    });

    const { outDir, report } = core.anonymizeFolder(full, { seed: 'test-seed-1' });
    const donorOut = JSON.parse(fs.readFileSync(path.join(outDir, 'donor.json'), 'utf8'));
    const tissueOut = JSON.parse(fs.readFileSync(path.join(outDir, 'tissue.json'), 'utf8'));

    assert.notEqual(donorOut[0].uuid, donorUuid);
    assert.equal(tissueOut[0].donor, donorOut[0].uuid, 'the link should point at the SAME remapped uuid');
    assert.equal(donorOut[0].submitted_id, '[redacted]');
    assert.ok(report.types.donor.scrubbedFields.includes('submitted_id'));
  });

  test('is reproducible for the same seed (including jittered dates)', () => {
    const full = core.createFolder('anon-b');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [{ uuid: 'cccccccc-3333-4ccc-8ccc-cccccccccccc', age: 50, date_created: '2020-01-01' }],
    });
    const run1 = core.anonymizeFolder(full, {
      seed: 'same-seed',
      outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'anon-run1-')),
    });
    const run2 = core.anonymizeFolder(full, {
      seed: 'same-seed',
      outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'anon-run2-')),
    });
    const d1 = JSON.parse(fs.readFileSync(path.join(run1.outDir, 'donor.json'), 'utf8'));
    const d2 = JSON.parse(fs.readFileSync(path.join(run2.outDir, 'donor.json'), 'utf8'));
    assert.deepEqual(d1, d2);
  });

  test('redacts a shuffle-eligible field instead of shuffling when the group is too small', () => {
    const full = core.createFolder('anon-small-group');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [{ uuid: 'dddddddd-4444-4ddd-8ddd-dddddddddddd', sex: 'F' }],
    });
    const { report } = core.anonymizeFolder(full, { seed: 'x' });
    assert.equal(report.types.donor.shuffleSkippedTooSmall.length, 1);
    assert.equal(report.types.donor.shuffleSkippedTooSmall[0].field, 'sex');
  });

  test('refuses a source folder outside the temp-local-inserts prefix', () => {
    assert.throws(() => core.anonymizeFolder('not-a-valid-folder'), /is not a valid inserts folder/);
  });

  test('refuses to write into a non-empty existing output directory', () => {
    const full = core.createFolder('anon-c');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-taken-'));
    fs.writeFileSync(path.join(outDir, 'stray.txt'), 'x');
    assert.throws(() => core.anonymizeFolder(full, { outDir }), /already exists and is not empty/);
  });

  test('never writes into INSERTS_BASE or BRANCHES_BASE — always an external export dir', () => {
    const full = core.createFolder('anon-d');
    const { outDir } = core.anonymizeFolder(full, { seed: 'y' });
    assert.ok(!outDir.startsWith(core.INSERTS_BASE));
    assert.ok(!outDir.startsWith(core.BRANCHES_BASE));
  });
});

describe('appendLog / readLogFile', () => {
  test('appends timestamped entries and reads them back in order', () => {
    fs.rmSync(core.LOG_FILE, { force: true });
    core.appendLog('hello world');
    const lines = core.readLogFile();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\] hello world$/);
  });

  test('trims the on-disk log to the most recent 500 lines', () => {
    fs.rmSync(core.LOG_FILE, { force: true });
    const bigMessage = Array.from({ length: 600 }, (_, i) => `line-${i}`).join('\n');
    core.appendLog(bigMessage);
    const lines = core.readLogFile();
    assert.equal(lines.length, 500);
    assert.ok(lines[0].endsWith('line-100'), 'the oldest 100 lines should have been trimmed off');
    assert.ok(lines[499].endsWith('line-599'));
  });

  test('readLogFile returns [] when no log file exists yet', () => {
    fs.rmSync(core.LOG_FILE, { force: true });
    assert.deepEqual(core.readLogFile(), []);
  });
});
