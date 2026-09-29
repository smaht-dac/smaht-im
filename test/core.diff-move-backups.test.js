import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempEnv, writeFolderFiles, resetInsertState } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

describe('findItemsByUuid', () => {
  test('matches a uuid across every type in the folder, not just one', () => {
    const full = core.createFolder('search-a');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [{ uuid: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa' }],
      tissue: [{ uuid: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb' }],
    });
    const folder = core.loadFolder(full);

    const donorMatches = core.findItemsByUuid(folder, 'aaaaaaaa');
    assert.equal(donorMatches.length, 1);
    assert.equal(donorMatches[0].typeName, 'donor');
    assert.equal(donorMatches[0].item.uuid, 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa');

    const tissueMatches = core.findItemsByUuid(folder, 'bbbbbbbb');
    assert.equal(tissueMatches.length, 1);
    assert.equal(tissueMatches[0].typeName, 'tissue');
  });

  test('is a case-insensitive substring match, not an exact match', () => {
    const full = core.createFolder('search-b');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [{ uuid: 'ABCDEF12-0000-4000-8000-000000000000' }],
    });
    const folder = core.loadFolder(full);

    assert.equal(core.findItemsByUuid(folder, 'abcdef12').length, 1);
    assert.equal(core.findItemsByUuid(folder, 'CDEF').length, 1);
    assert.equal(core.findItemsByUuid(folder, 'not-in-there').length, 0);
  });

  test('returns every match when more than one uuid contains the query', () => {
    const full = core.createFolder('search-c');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [
        { uuid: '11110000-0000-4000-8000-000000000000' },
        { uuid: '11119999-0000-4000-8000-000000000000' },
      ],
    });
    const folder = core.loadFolder(full);

    assert.equal(core.findItemsByUuid(folder, '1111').length, 2);
  });

  test('returns [] for an empty query or a missing folder', () => {
    const full = core.createFolder('search-d');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'x' }] });
    const folder = core.loadFolder(full);

    assert.deepEqual(core.findItemsByUuid(folder, ''), []);
    assert.deepEqual(core.findItemsByUuid(folder, '   '), []);
    assert.deepEqual(core.findItemsByUuid(null, 'x'), []);
  });
});

describe('findItemsByUuidAcrossFolders', () => {
  test('searches every folder, tagging which one each match came from', () => {
    resetInsertState(core);
    const a = core.createFolder('multi-a');
    writeFolderFiles(path.join(core.BRANCHES_BASE, a), { donor: [{ uuid: 'aaaa0000-0000-4000-8000-000000000000' }] });
    const b = core.createFolder('multi-b');
    writeFolderFiles(path.join(core.BRANCHES_BASE, b), { donor: [{ uuid: 'bbbb0000-0000-4000-8000-000000000000' }] });

    const folders = core.loadAllFolders();
    const results = core.findItemsByUuidAcrossFolders(folders, 'aaaa0000');
    assert.equal(results.length, 1);
    assert.equal(results[0].folderName, a);
    assert.equal(results[0].typeName, 'donor');
  });

  test('marks which match belongs to the currently loaded folder', () => {
    resetInsertState(core);
    const a = core.createFolder('multi-c');
    writeFolderFiles(path.join(core.BRANCHES_BASE, a), { donor: [{ uuid: 'cccc0000-0000-4000-8000-000000000000' }] });
    core.switchFolder(a);
    const b = core.createFolder('multi-d');
    writeFolderFiles(path.join(core.BRANCHES_BASE, b), { donor: [{ uuid: 'cccc9999-0000-4000-8000-000000000000' }] });

    const folders = core.loadAllFolders();
    const results = core.findItemsByUuidAcrossFolders(folders, 'cccc');
    assert.equal(results.length, 2);
    assert.equal(results.find(r => r.folderName === a).isActiveFolder, true);
    assert.equal(results.find(r => r.folderName === b).isActiveFolder, false);
  });

  test('returns [] for a missing folders array', () => {
    assert.deepEqual(core.findItemsByUuidAcrossFolders(null, 'x'), []);
  });
});

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
