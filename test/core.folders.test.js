import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useTempEnv, resetInsertState, writeFolderFiles } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

describe('folderLabel / getLoadedFolder', () => {
  test('folderLabel strips the prefix and a leading separator', () => {
    assert.equal(core.folderLabel(`${core.INSERT_PREFIX}-devtest`), 'devtest');
    assert.equal(core.folderLabel(`${core.INSERT_PREFIX}_devtest`), 'devtest');
  });

  test('getLoadedFolder returns null when no HEAD file exists yet', () => {
    fs.rmSync(path.join(os.homedir(), '.smaht-im', 'HEAD'), { force: true });
    assert.equal(core.getLoadedFolder(), null);
  });
});

describe('loadFolder', () => {
  test('returns null for a folder that does not exist', () => {
    assert.equal(core.loadFolder(`${core.INSERT_PREFIX}-does-not-exist`), null);
  });

  test('reads types/items/counts from the JSON files on disk', () => {
    const full = core.createFolder('with-data');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), {
      donor: [{ uuid: 'u1', submitted_id: 'D1', status: 'shared' }],
      tissue: [{ uuid: 'u2' }, { uuid: 'u3' }],
    });
    const folder = core.loadFolder(full);
    assert.equal(folder.totalItems, 3);
    const donorType = folder.types.find((t) => t.name === 'donor');
    assert.equal(donorType.count, 1);
    assert.equal(donorType.items[0].displayId, 'D1');
    assert.equal(donorType.items[0].uuid, 'u1');
  });
});

describe('createFolder', () => {
  test('creates an empty branch with a placeholder donor.json (never truly zero files)', () => {
    const full = core.createFolder('empty-one');
    assert.equal(full, `${core.INSERT_PREFIX}-empty-one`);
    const donor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'));
    assert.deepEqual(donor, []);
  });

  test('copies files from a base branch when given one', () => {
    const base = core.createFolder('base-branch');
    writeFolderFiles(path.join(core.BRANCHES_BASE, base), { donor: [{ uuid: 'u1' }] });
    const full = core.createFolder('from-base', base);
    const donor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'));
    assert.deepEqual(donor, [{ uuid: 'u1' }]);
  });

  test('sanitizes the given name into a slug', () => {
    const full = core.createFolder('My Cool Branch!!');
    assert.equal(full, `${core.INSERT_PREFIX}-My-Cool-Branch`);
  });

  test('rejects a duplicate name', () => {
    core.createFolder('dup');
    assert.throws(() => core.createFolder('dup'), /already exists/);
  });

  test('rejects a name that sanitizes to empty', () => {
    assert.throws(() => core.createFolder('   '), /invalid/);
  });

  test('rejects a base branch that does not exist', () => {
    assert.throws(
      () => core.createFolder('orphan', `${core.INSERT_PREFIX}-nope`),
      /Base folder .* not found/,
    );
  });
});

describe('switchFolder', () => {
  test('copies the target folder into the working copy and updates HEAD', () => {
    const full = core.createFolder('alpha');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'u1' }] });
    const msg = core.switchFolder(full);
    assert.match(msg, /Switched to 'alpha'/);
    assert.equal(core.getLoadedFolder(), full);
    const workingDonor = JSON.parse(
      fs.readFileSync(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER, 'donor.json'), 'utf8'),
    );
    assert.deepEqual(workingDonor, [{ uuid: 'u1' }]);
  });

  test('no-ops with a friendly message when already the loaded folder', () => {
    const full = core.createFolder('beta');
    core.switchFolder(full);
    const msg = core.switchFolder(full);
    assert.match(msg, /Already using 'beta'/);
  });

  test('refuses to switch to the working copy itself', () => {
    assert.throws(() => core.switchFolder(core.ACTIVE_FOLDER), /Cannot switch to the working copy directly/);
  });

  test('refuses a name outside the temp-local-inserts prefix', () => {
    assert.throws(() => core.switchFolder('not-a-valid-name'), /is not a valid inserts folder/);
  });

  test('refuses a folder that does not exist', () => {
    assert.throws(() => core.switchFolder(`${core.INSERT_PREFIX}-ghost`), /not found/);
  });
});

describe('renameFolder', () => {
  test('renames a branch and moves HEAD along if it was the loaded folder', () => {
    const full = core.createFolder('old-name');
    core.switchFolder(full);
    const renamed = core.renameFolder(full, 'new-name');
    assert.equal(renamed, `${core.INSERT_PREFIX}-new-name`);
    assert.equal(core.getLoadedFolder(), renamed);
    assert.ok(fs.existsSync(path.join(core.BRANCHES_BASE, renamed)));
    assert.ok(!fs.existsSync(path.join(core.BRANCHES_BASE, full)));
  });

  test('refuses to rename the working copy', () => {
    assert.throws(() => core.renameFolder(core.ACTIVE_FOLDER, 'x'), /Cannot rename the working copy/);
  });

  test('refuses a collision with an existing folder', () => {
    core.createFolder('rename-a');
    core.createFolder('rename-b');
    assert.throws(
      () => core.renameFolder(`${core.INSERT_PREFIX}-rename-a`, 'rename-b'),
      /already exists/,
    );
  });

  test('refuses a source folder that does not exist', () => {
    assert.throws(() => core.renameFolder(`${core.INSERT_PREFIX}-ghost2`, 'y'), /not found/);
  });
});

describe('createSnapshot', () => {
  test('copies the working copy into a new named folder', () => {
    writeFolderFiles(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER), { donor: [{ uuid: 'snap1' }] });
    const name = core.createSnapshot('my-snap');
    assert.equal(name, `${core.INSERT_PREFIX}-my-snap`);
    const donor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, name, 'donor.json'), 'utf8'));
    assert.deepEqual(donor, [{ uuid: 'snap1' }]);
  });

  test('refuses a duplicate snapshot name', () => {
    writeFolderFiles(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER), { donor: [] });
    core.createSnapshot('dup-snap');
    assert.throws(() => core.createSnapshot('dup-snap'), /already exists/);
  });

  test('throws when there is no working copy to snapshot', () => {
    fs.rmSync(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER), { recursive: true, force: true });
    assert.throws(() => core.createSnapshot('no-active'), /does not exist/);
  });
});

describe('deleteFolder', () => {
  test('removes a branch folder', () => {
    const full = core.createFolder('to-delete');
    const msg = core.deleteFolder(full);
    assert.match(msg, /Deleted/);
    assert.ok(!fs.existsSync(path.join(core.BRANCHES_BASE, full)));
  });

  test('refuses to delete the working copy', () => {
    assert.throws(() => core.deleteFolder(core.ACTIVE_FOLDER), /Cannot delete the working copy/);
  });

  test('refuses to delete the currently loaded folder', () => {
    const full = core.createFolder('loaded-one');
    core.switchFolder(full);
    assert.throws(() => core.deleteFolder(full), /Cannot delete the loaded folder/);
  });

  test('refuses a name outside the temp-local-inserts prefix', () => {
    assert.throws(() => core.deleteFolder('random-dir'), /not a valid branch/);
  });

  test('refuses a folder that does not exist', () => {
    assert.throws(() => core.deleteFolder(`${core.INSERT_PREFIX}-ghost3`), /does not exist/);
  });
});

describe('loadAllFolders', () => {
  test('bootstraps a "main" folder from the working copy on first run', () => {
    resetInsertState(core);
    writeFolderFiles(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER), { donor: [{ uuid: 'boot1' }] });
    const folders = core.loadAllFolders();
    assert.equal(folders.length, 1);
    assert.equal(folders[0].name, `${core.INSERT_PREFIX}-main`);
    assert.equal(folders[0].isActive, true);
  });

  test('puts the loaded folder first regardless of name/recency ordering', () => {
    resetInsertState(core);
    core.createFolder('list-a');
    const b = core.createFolder('list-b');
    core.switchFolder(b);
    const folders = core.loadAllFolders();
    assert.equal(folders[0].name, b);
    assert.ok(folders[0].isActive);
  });

  test('auto-snapshots the working copy when it diverges from the loaded folder', () => {
    resetInsertState(core);
    const a = core.createFolder('div-a');
    core.switchFolder(a);
    // Simulate an external edit to the working copy that no longer matches folder 'a'
    writeFolderFiles(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER), { donor: [{ uuid: 'external-edit' }] });
    const folders = core.loadAllFolders();
    const active = folders.find((f) => f.isActive);
    assert.notEqual(active.name, a);
    assert.ok(active.name.startsWith(core.INSERT_PREFIX));
  });

  test('never returns the working copy (temp-local-inserts) itself as a row', () => {
    resetInsertState(core);
    writeFolderFiles(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER), { donor: [{ uuid: 'x' }] });
    const folders = core.loadAllFolders();
    assert.ok(!folders.some((f) => f.name === core.ACTIVE_FOLDER));
  });
});
