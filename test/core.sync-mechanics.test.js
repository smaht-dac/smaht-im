import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempEnv } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

// These control the fake `update-inserts-from-server` on PATH — see
// test/fixtures/bin/update-inserts-from-server. Reset before every test so
// one test's settings can never leak into the next (they all share this
// file's single process/env).
beforeEach(() => {
  delete process.env.FAKE_UPDATE_INSERTS_EXIT_CODE;
  delete process.env.FAKE_UPDATE_INSERTS_UUID;
  delete process.env.FAKE_UPDATE_INSERTS_TYPE;
});

function trackedBranch(name) {
  const full = core.createFolder(name);
  core.saveBranchMeta(full, { __tracking__: { env: 'data', query: 'type=Donor' } });
  return full;
}

describe('syncFolderAsync', () => {
  test('short-circuits with no spawn when the folder has no tracking query', async () => {
    const full = core.createFolder('sync-no-query');
    // onDone fires synchronously on this early-return path, before the
    // `= core.syncFolderAsync(...)` assignment below finishes — so the
    // callback must not read the not-yet-initialized `ret`. Capture it into
    // a separately-declared `let` and check it only after the promise
    // resolves.
    let ret;
    await new Promise((resolve) => {
      ret = core.syncFolderAsync(full, () => {}, (success, msg) => {
        assert.equal(success, false);
        assert.match(msg, /No tracking query/);
        resolve();
      });
    });
    assert.equal(ret.cmd, null);
  });

  test('runs the pull tool, backs up the folder first, and reports a diff on success', () => {
    const full = trackedBranch('sync-ok');
    process.env.FAKE_UPDATE_INSERTS_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    return new Promise((resolve) => {
      const lines = [];
      core.syncFolderAsync(full, (line) => lines.push(line), (success, msg, diff) => {
        assert.equal(success, true);
        assert.equal(msg, 'Sync complete');
        assert.ok(lines.length > 0, 'should have streamed some output lines');
        const donorDiff = diff.find((d) => d.type === 'donor');
        assert.equal(donorDiff.added, 1);
        assert.equal(core.listBackups(full).length, 1, 'should have backed up before syncing');
        resolve();
      });
    });
  });

  test('reports failure and leaves the folder untouched when the tool exits non-zero', () => {
    const full = trackedBranch('sync-fail');
    const before = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'));
    process.env.FAKE_UPDATE_INSERTS_EXIT_CODE = '1';
    return new Promise((resolve) => {
      core.syncFolderAsync(full, () => {}, (success, msg, diff) => {
        assert.equal(success, false);
        assert.equal(msg, 'Sync failed');
        assert.equal(diff, null);
        const after = JSON.parse(fs.readFileSync(path.join(core.BRANCHES_BASE, full, 'donor.json'), 'utf8'));
        assert.deepEqual(after, before);
        resolve();
      });
    });
  });
});

describe('pullBatchIntoFolderAsync', () => {
  test('short-circuits when given no queries', () => {
    const full = core.createFolder('batch-empty');
    return new Promise((resolve) => {
      core.pullBatchIntoFolderAsync(full, 'data', [], () => {}, () => {}, (result) => {
        assert.equal(result.success, false);
        assert.equal(result.totalCount, 0);
        resolve();
      });
    });
  });

  test('runs queries sequentially, in order, and does NOT create a backup (deliberately additive)', () => {
    const full = core.createFolder('batch-ok');
    const queriesSeen = [];
    return new Promise((resolve) => {
      core.pullBatchIntoFolderAsync(
        full,
        'data',
        ['type=Donor', 'type=Tissue'],
        (i, total, q) => queriesSeen.push(q),
        () => {},
        (result) => {
          assert.equal(result.success, true);
          assert.equal(result.ranCount, 2);
          assert.deepEqual(queriesSeen, ['type=Donor', 'type=Tissue']);
          assert.equal(core.listBackups(full).length, 0);
          resolve();
        },
      );
    });
  });

  test('stops at the first failing query rather than skipping past it', () => {
    const full = core.createFolder('batch-partial-fail');
    let call = 0;
    return new Promise((resolve) => {
      core.pullBatchIntoFolderAsync(
        full,
        'data',
        ['type=Donor', 'type=WillFail', 'type=NeverReached'],
        (i, total, q) => {
          call += 1;
          // Fail only on the 2nd query
          if (call === 2) process.env.FAKE_UPDATE_INSERTS_EXIT_CODE = '1';
          else delete process.env.FAKE_UPDATE_INSERTS_EXIT_CODE;
        },
        () => {},
        (result) => {
          assert.equal(result.success, false);
          assert.equal(result.ranCount, 1);
          assert.equal(result.failedQuery, 'type=WillFail');
          resolve();
        },
      );
    });
  });
});

describe('syncItemAsync', () => {
  test('fails immediately when there are no credentials for the env, no network call made', () => {
    const full = core.createFolder('item-sync-no-creds');
    return new Promise((resolve) => {
      core.syncItemAsync(full, 'donor', 'some-uuid', 'data', (success, msg, changes) => {
        assert.equal(success, false);
        assert.match(msg, /No credentials/);
        assert.equal(changes, null);
        resolve();
      });
    });
  });
});
