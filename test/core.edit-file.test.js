import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempEnv, writeFolderFiles, FIXTURES_BIN } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

const FAKE_EDITOR = path.join(FIXTURES_BIN, 'fake-editor');

beforeEach(() => {
  process.env.EDITOR = FAKE_EDITOR;
  delete process.env.VISUAL;
  delete process.env.FAKE_EDITOR_EXIT_CODE;
  delete process.env.FAKE_EDITOR_MODE;
});

describe('editTypeFile', () => {
  test('applies the edit and backs the folder up first', () => {
    const full = core.createFolder('edit-ok');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'd1' }] });

    const result = core.editTypeFile(full, 'donor');
    assert.deepEqual(result, { edited: true });

    const donor = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'));
    assert.deepEqual(donor, [{ uuid: 'd1' }, { uuid: 'edited-1' }]);
    assert.equal(core.listBackups(full).length, 1, 'should have backed up before opening the editor');
  });

  test('reports editor abort (non-zero exit) without touching the file further', () => {
    const full = core.createFolder('edit-abort');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'd1' }] });
    process.env.FAKE_EDITOR_EXIT_CODE = '1';

    const result = core.editTypeFile(full, 'donor');
    assert.equal(result.edited, false);
    assert.match(result.error, /Editor exited with status 1/);
  });

  test('reports invalid JSON left behind by the editor, without discarding it', () => {
    const full = core.createFolder('edit-corrupt');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'd1' }] });
    process.env.FAKE_EDITOR_MODE = 'corrupt';

    const result = core.editTypeFile(full, 'donor');
    assert.equal(result.edited, false);
    assert.match(result.error, /not valid JSON/);
    // Left exactly as the "editor" wrote it — not auto-reverted.
    assert.equal(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'), '{ not valid json');
  });

  test('throws for a type file that does not exist', () => {
    const full = core.createFolder('edit-missing');
    assert.throws(() => core.editTypeFile(full, 'tissue'), /not found/);
  });

  test('mirrors the edit into the working copy when the edited folder is currently loaded', () => {
    const full = core.createFolder('edit-active');
    writeFolderFiles(path.join(core.BRANCHES_BASE, full), { donor: [{ uuid: 'd1' }] });
    core.switchFolder(full);

    core.editTypeFile(full, 'donor');

    const working = JSON.parse(
      fs.readFileSync(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER, 'donor.json'), 'utf8'),
    );
    assert.deepEqual(working, [{ uuid: 'd1' }, { uuid: 'edited-1' }]);
  });

  test('does NOT touch the working copy when editing a folder that is not currently loaded', () => {
    const loaded = core.createFolder('edit-loaded');
    writeFolderFiles(path.join(core.BRANCHES_BASE, loaded), { donor: [{ uuid: 'loaded1' }] });
    core.switchFolder(loaded);

    const other = core.createFolder('edit-other');
    writeFolderFiles(path.join(core.BRANCHES_BASE, other), { donor: [{ uuid: 'other1' }] });
    core.editTypeFile(other, 'donor');

    const working = JSON.parse(
      fs.readFileSync(path.join(core.INSERTS_BASE, core.ACTIVE_FOLDER, 'donor.json'), 'utf8'),
    );
    assert.deepEqual(working, [{ uuid: 'loaded1' }], 'working copy should still reflect the loaded folder, unaffected by editing a different one');
  });
});
