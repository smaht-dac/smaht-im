import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempEnv, writeFolderFiles } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

describe('computeDiff', () => {
  test('reports added/removed/same at the type level between two folders', () => {
    const a = core.createFolder('diff-a');
    writeFolderFiles(path.join(core.BRANCHES_BASE, a), { donor: [{ uuid: 'u1' }, { uuid: 'u2' }] });
    const b = core.createFolder('diff-b');
    writeFolderFiles(path.join(core.BRANCHES_BASE, b), { donor: [{ uuid: 'u2' }, { uuid: 'u3' }] });

    const diff = core.computeDiff(a, b);
    const donorDiff = diff.find((d) => d.type === 'donor');
    assert.equal(donorDiff.added, 1); // u3
    assert.equal(donorDiff.removed, 1); // u1
    assert.equal(donorDiff.same, 1); // u2
  });

  test('includes a type that exists in only one of the two folders', () => {
    const a = core.createFolder('diff-c');
    writeFolderFiles(path.join(core.BRANCHES_BASE, a), { donor: [{ uuid: 'u1' }] });
    const b = core.createFolder('diff-d');
    writeFolderFiles(path.join(core.BRANCHES_BASE, b), { donor: [{ uuid: 'u1' }], tissue: [{ uuid: 't1' }] });

    const diff = core.computeDiff(a, b);
    const tissueDiff = diff.find((d) => d.type === 'tissue');
    assert.equal(tissueDiff.countA, 0);
    assert.equal(tissueDiff.countB, 1);
    assert.equal(tissueDiff.added, 1);
  });
});

describe('moveItems', () => {
  test('moves matching items from src to dst and removes them from src', () => {
    const src = core.createFolder('move-src');
    writeFolderFiles(path.join(core.BRANCHES_BASE, src), { donor: [{ uuid: 'm1' }, { uuid: 'm2' }] });
    const dst = core.createFolder('move-dst');

    const result = core.moveItems(new Set(['m1']), src, dst, 'donor');
    assert.equal(result.moved, 1);
    assert.equal(result.skipped, 0);

    const srcDonor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, src, 'donor.json'), 'utf8'));
    const dstDonor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, dst, 'donor.json'), 'utf8'));
    assert.deepEqual(srcDonor.map((i) => i.uuid), ['m2']);
    assert.deepEqual(dstDonor.map((i) => i.uuid), ['m1']);
  });

  test('skips items that already exist in the destination', () => {
    const src = core.createFolder('move-src2');
    writeFolderFiles(path.join(core.BRANCHES_BASE, src), { donor: [{ uuid: 'd1' }] });
    const dst = core.createFolder('move-dst2');
    writeFolderFiles(path.join(core.BRANCHES_BASE, dst), { donor: [{ uuid: 'd1' }] });

    const result = core.moveItems(new Set(['d1']), src, dst, 'donor');
    assert.equal(result.moved, 0);
    assert.equal(result.skipped, 1);
  });

  test('returns a no-match message when nothing matches', () => {
    const src = core.createFolder('move-src3');
    writeFolderFiles(path.join(core.BRANCHES_BASE, src), { donor: [{ uuid: 'x' }] });
    const dst = core.createFolder('move-dst3');

    const result = core.moveItems(new Set(['not-there']), src, dst, 'donor');
    assert.equal(result.moved, 0);
    assert.match(result.message, /No matching items/);
  });

  test('refuses non-prefixed source/destination names', () => {
    const dst = core.createFolder('move-dst4');
    assert.throws(
      () => core.moveItems(new Set(['x']), 'not-valid', dst, 'donor'),
      /Source/,
    );
    const src = core.createFolder('move-src4');
    assert.throws(
      () => core.moveItems(new Set(['x']), src, 'not-valid', 'donor'),
      /Destination/,
    );
  });
});

describe('backupFolder / listBackups / restoreBackup', () => {
  test('backupFolder returns null for a folder with no JSON files', () => {
    const full = core.createFolder('backup-empty');
    fs.rmSync(path.join(core.BRANCHES_BASE, full, 'donor.json'));
    assert.equal(core.backupFolder(full, 'test'), null);
  });

  test('backupFolder snapshots current files, and restoreBackup brings them back', () => {
    const full = core.createFolder('backup-a');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'v1' }] });
    const id = core.backupFolder(full, 'manual test backup');
    assert.ok(id);

    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'v2' }] });
    core.restoreBackup(full, id);

    const donor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'));
    assert.deepEqual(donor, [{ uuid: 'v1' }]);
  });

  test('listBackups lists newest first', async () => {
    const full = core.createFolder('backup-list');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'l1' }] });
    const id1 = core.backupFolder(full, 'first');
    // Backup ids are `<ISO ms timestamp>-<random suffix>`; two backups in the
    // same millisecond would only differ by that random suffix, which has no
    // relation to creation order — so without a small gap, "newest first"
    // isn't actually well-defined between them. A few ms is enough to land
    // in a different millisecond bucket.
    await new Promise((resolve) => setTimeout(resolve, 5));
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'l2' }] });
    const id2 = core.backupFolder(full, 'second');

    const list = core.listBackups(full);
    assert.equal(list[0].id, id2);
    assert.equal(list[1].id, id1);
  });

  // Mirrors the documented MAX_BACKUPS_PER_FOLDER cap in src/core.js (10) —
  // not exported, so re-derived here from behavior rather than the constant.
  test('prunes to the 10 most recent backups per folder', () => {
    const full = core.createFolder('backup-prune');
    for (let i = 0; i < 12; i++) {
      writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: `p${i}` }] });
      core.backupFolder(full, `backup ${i}`);
    }
    assert.equal(core.listBackups(full).length, 10);
  });

  test('restoreBackup itself backs up the current state first, so a restore is never a dead end', () => {
    const full = core.createFolder('backup-restore-safety');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'r1' }] });
    const id = core.backupFolder(full, 'first state');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'r2' }] });

    const before = core.listBackups(full).length;
    core.restoreBackup(full, id);
    const after = core.listBackups(full).length;
    assert.equal(after, before + 1);
  });

  test('restoreBackup throws for an unknown backup id', () => {
    const full = core.createFolder('backup-unknown');
    assert.throws(() => core.restoreBackup(full, 'nonexistent-id'), /Backup not found/);
  });
});
