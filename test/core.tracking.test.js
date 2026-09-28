import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useTempEnv } from './helpers/env.js';

useTempEnv();
const core = await import('../src/core.js');

describe('loadBranchMeta / saveBranchMeta', () => {
  test('loadBranchMeta returns {} when no manifest exists', () => {
    assert.deepEqual(core.loadBranchMeta('nonexistent'), {});
  });

  test('saveBranchMeta merges updates into the existing manifest rather than replacing it', () => {
    core.saveBranchMeta('meta-a', { foo: 1 });
    core.saveBranchMeta('meta-a', { bar: 2 });
    assert.deepEqual(core.loadBranchMeta('meta-a'), { foo: 1, bar: 2 });
  });
});

describe('getFolderEnvs', () => {
  test('collects distinct envs across per-type entries, newest last_pulled first', () => {
    core.saveBranchMeta('envs-a', {
      types: {
        Donor: { env: 'data', last_pulled: '2024-01-01T00:00:00Z' },
        Tissue: { env: 'staging', last_pulled: '2024-06-01T00:00:00Z' },
      },
    });
    assert.deepEqual(core.getFolderEnvs('envs-a'), ['staging', 'data']);
  });

  test('falls back to __tracking__.env when no per-type entry has one', () => {
    core.saveBranchMeta('envs-b', { __tracking__: { env: 'devtest', query: 'type=Donor' } });
    assert.deepEqual(core.getFolderEnvs('envs-b'), ['devtest']);
  });

  test('returns an empty array for an untracked folder', () => {
    assert.deepEqual(core.getFolderEnvs('envs-none'), []);
  });
});

describe('getFolderTracking', () => {
  test('prefers the most-recently-pulled per-type query over __tracking__', () => {
    core.saveBranchMeta('track-a', {
      types: {
        Donor: { env: 'data', query: 'type=Donor', last_pulled: '2024-01-01T00:00:00Z' },
        Tissue: { env: 'data', query: 'type=Tissue', last_pulled: '2024-06-01T00:00:00Z' },
      },
      __tracking__: { env: 'data', query: 'manual-query' },
    });
    assert.deepEqual(core.getFolderTracking('track-a'), {
      env: 'data', query: 'type=Tissue', last_pulled: '2024-06-01T00:00:00Z',
    });
  });

  test('falls back to __tracking__ when there is no per-type query', () => {
    core.saveBranchMeta('track-b', { __tracking__: { env: 'data', query: 'only-manual' } });
    assert.deepEqual(core.getFolderTracking('track-b'), { env: 'data', query: 'only-manual' });
  });

  test('returns null when neither exists', () => {
    assert.equal(core.getFolderTracking('track-none'), null);
  });
});

describe('loadEnvAuth', () => {
  test('returns null when ~/.smaht-keys.json is missing', () => {
    assert.equal(core.loadEnvAuth('data'), null);
  });

  test('returns null when the entry is missing key/secret/server', () => {
    const keysFile = path.join(os.homedir(), '.smaht-keys.json');
    fs.writeFileSync(keysFile, JSON.stringify({ data: { key: 'k' } }));
    assert.equal(core.loadEnvAuth('data'), null);
  });

  test('returns the entry when complete', () => {
    const keysFile = path.join(os.homedir(), '.smaht-keys.json');
    fs.writeFileSync(keysFile, JSON.stringify({ data: { key: 'k', secret: 's', server: 'https://x.example' } }));
    assert.deepEqual(core.loadEnvAuth('data'), { key: 'k', secret: 's', server: 'https://x.example' });
  });
});

describe('checkRemoteAsync (paths that never touch the network)', () => {
  test('reports "untracked" synchronously when nothing is tracked, no network call made', () => {
    return new Promise((resolve) => {
      core.checkRemoteAsync('remote-untracked', (result) => {
        assert.deepEqual(result, { status: 'untracked' });
        resolve();
      });
    });
  });

  test('serves a cached result within the 5-minute TTL without a network call', () => {
    core.saveBranchMeta('remote-cached', {
      __tracking__: { env: 'data', query: 'type=Donor' },
      __remote_cache__: { checked_at: new Date().toISOString(), behind: 3, ahead: 1, error: null },
    });
    return new Promise((resolve) => {
      core.checkRemoteAsync('remote-cached', (result) => {
        assert.equal(result.status, 'ok');
        assert.equal(result.behind, 3);
        assert.equal(result.ahead, 1);
        resolve();
      });
    });
  });
});
