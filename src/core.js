/**
 * core.js — data operations for imc
 * All reads/writes are synchronous; only touches temp-local-inserts* directories.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const REPO_ROOT =
  process.env.SMAHT_REPO_ROOT ?? path.join(os.homedir(), 'dbmi', 'smaht-portal');

export const INSERTS_BASE = path.join(
  REPO_ROOT,
  'src',
  'encoded',
  'tests',
  'data',
);

export const ACTIVE_FOLDER = 'temp-local-inserts';
export const INSERT_PREFIX = 'temp-local-inserts';

const HISTORY_FILE = path.join(os.homedir(), '.smaht-im', 'activation-history.json');
const HEAD_FILE     = path.join(os.homedir(), '.smaht-im', 'HEAD');

/** Strip the common prefix to get the human-readable branch name. */
export function folderLabel(fullName) {
  return fullName.slice(INSERT_PREFIX.length).replace(/^[-_]/, '');
}

/** Returns the currently checked-out branch's full folder name, or null. */
export function getLoadedFolder() {
  try { return fs.readFileSync(HEAD_FILE, 'utf8').trim() || null; }
  catch { return null; }
}

function setLoadedFolder(name) {
  fs.mkdirSync(path.dirname(HEAD_FILE), { recursive: true });
  fs.writeFileSync(HEAD_FILE, name);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

function safeSlug(name) {
  return name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
}

function displayId(item) {
  return (
    item.submitted_id ??
    item.accession ??
    item.identifier ??
    item.title ??
    (item.uuid ? item.uuid.slice(0, 12) + '…' : '—')
  );
}

// ── load ──────────────────────────────────────────────────────────────────────

/**
 * Load a single insert folder: returns { name, path, types, totalItems }
 * where types is an array of { name, items, count }.
 */
export function loadFolder(folderName) {
  const folderPath = path.join(INSERTS_BASE, folderName);
  const types = [];

  if (!fs.existsSync(folderPath)) return null;

  const files = fs.readdirSync(folderPath)
    .filter(f => f.endsWith('.json'))
    .sort();

  for (const file of files) {
    const typeName = file.replace(/\.json$/, '');
    const items = readJson(path.join(folderPath, file));
    const list = Array.isArray(items) ? items : [];
    types.push({
      name: typeName,
      count: list.length,
      items: list.map(d => ({
        uuid: d.uuid ?? '',
        displayId: displayId(d),
        status: d.status ?? '',
        data: d,
      })),
    });
  }

  const totalItems = types.reduce((sum, t) => sum + t.count, 0);

  // Most-recent mtime: JSON files first, fall back to directory mtime for empty folders
  let lastUpdated = null;
  for (const file of files) {
    try {
      const mtime = fs.statSync(path.join(folderPath, file)).mtime;
      if (!lastUpdated || mtime > lastUpdated) lastUpdated = mtime;
    } catch { /* ignore */ }
  }
  if (!lastUpdated) {
    try { lastUpdated = fs.statSync(folderPath).mtime; } catch { /* ignore */ }
  }

  return { name: folderName, path: folderPath, types, totalItems, isActive: false, lastUpdated };
}

/**
 * Load all named branches (excludes the working copy temp-local-inserts).
 * On first run, bootstraps a 'main' branch from the working copy.
 * The checked-out branch (from HEAD) is always first; others are sorted.
 */
export function loadAllFolders() {
  if (!fs.existsSync(INSERTS_BASE)) return [];

  const entries = fs.readdirSync(INSERTS_BASE, { withFileTypes: true });
  let names = entries
    .filter(e => e.isDirectory() && e.name.startsWith(INSERT_PREFIX) && e.name !== ACTIVE_FOLDER)
    .map(e => e.name)
    .sort();

  // Bootstrap: no branches yet — create 'main' from the working copy
  if (names.length === 0) {
    const activePath = path.join(INSERTS_BASE, ACTIVE_FOLDER);
    if (fs.existsSync(activePath)) {
      const mainName = `${INSERT_PREFIX}-main`;
      fs.cpSync(activePath, path.join(INSERTS_BASE, mainName), { recursive: true });
      names = [mainName];
    }
  }

  // Resolve HEAD; fall back to first branch if HEAD is missing or stale
  let active = getLoadedFolder();
  if (!active || !names.includes(active)) {
    active = names[0] ?? null;
    if (active) setLoadedFolder(active);
  }

  const folders = names.map(n => {
    const f = loadFolder(n);
    return f ? { ...f, isActive: n === active } : null;
  }).filter(Boolean);

  // Loaded folder always first, then by most-recently-updated, then name
  return folders.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const ta = a.lastUpdated?.getTime() ?? 0;
    const tb = b.lastUpdated?.getTime() ?? 0;
    return tb - ta || a.name.localeCompare(b.name);
  });
}

// ── switch folder ─────────────────────────────────────────────────────────────

/**
 * Switch the loaded folder: copy its contents into the working copy
 * (temp-local-inserts) and update HEAD.
 * Returns a status string on success; throws on failure.
 */
export function switchFolder(targetName) {
  const currentLoaded = getLoadedFolder();
  if (targetName === currentLoaded) return `Already using '${folderLabel(targetName)}'.`;
  if (targetName === ACTIVE_FOLDER) throw new Error('Cannot switch to the working copy directly');
  if (!targetName.startsWith(INSERT_PREFIX)) throw new Error(`'${targetName}' is not a valid inserts folder`);

  const activePath = path.join(INSERTS_BASE, ACTIVE_FOLDER);
  const targetPath = path.join(INSERTS_BASE, targetName);

  if (!fs.existsSync(targetPath)) throw new Error(`Folder '${folderLabel(targetName)}' not found`);

  // Clear working copy and replace with target folder content
  fs.mkdirSync(activePath, { recursive: true });
  for (const f of fs.readdirSync(activePath).filter(n => n.endsWith('.json'))) {
    fs.unlinkSync(path.join(activePath, f));
  }
  for (const f of fs.readdirSync(targetPath).filter(n => n.endsWith('.json'))) {
    fs.copyFileSync(path.join(targetPath, f), path.join(activePath, f));
  }

  setLoadedFolder(targetName);
  _recordHistory(currentLoaded ?? ACTIVE_FOLDER, targetName);

  return `Switched to '${folderLabel(targetName)}'`;
}

// ── create branch ────────────────────────────────────────────────────────────

/**
 * Create a new empty branch (or copy json files from baseBranch).
 * Returns the full folder name (INSERT_PREFIX + '-' + slug).
 */
export function createFolder(name, baseBranch = null) {
  const slug = safeSlug(name);
  if (!slug) throw new Error('Folder name is invalid');
  const fullName = `${INSERT_PREFIX}-${slug}`;
  const newPath  = path.join(INSERTS_BASE, fullName);

  if (fs.existsSync(newPath)) throw new Error(`Folder '${slug}' already exists`);
  fs.mkdirSync(newPath, { recursive: true });

  if (baseBranch) {
    const basePath = path.join(INSERTS_BASE, baseBranch);
    if (!fs.existsSync(basePath)) throw new Error(`Base folder '${folderLabel(baseBranch)}' not found`);
    for (const f of fs.readdirSync(basePath).filter(n => n.endsWith('.json'))) {
      fs.copyFileSync(path.join(basePath, f), path.join(newPath, f));
    }
  }

  return fullName;
}

/**
 * Run update-inserts-from-server without --dest so it writes to the default
 * temp-local-inserts (the working copy). The caller must switch to the target
 * folder first so that folder is the active working copy.
 *
 * onLine(line) is called for each output line as it arrives (live progress).
 * onDone(success) is called when the process exits.
 * Returns the user-facing command string for logging.
 */
export function pullFolderAsync(env, query, onLine, onDone) {
  const displayCmd = `pull-inserts ${env} smaht "${query}"`;

  const child = spawn(
    'update-inserts-from-server',
    ['--env', env, '--portal', 'smaht', '--search', query],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYENV_VERSION: 'smaht311' },
      cwd: REPO_ROOT,
    },
  );

  let buf = '';
  const flush = (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) { if (line.trim()) onLine(line.trim()); }
  };
  child.stdout?.on('data', flush);
  child.stderr?.on('data', flush);
  child.on('close', code => {
    if (buf.trim()) onLine(buf.trim());
    onDone(code === 0);
  });
  child.on('error', err => {
    onLine(`spawn error: ${err.message}`);
    onDone(false);
  });
  return displayCmd;
}

/**
 * Copy all JSON files from the working copy (temp-local-inserts) into a named
 * folder, replacing whatever was there. Used to persist a pull result.
 */
export function syncWorkingCopyToFolder(targetName) {
  const srcPath = path.join(INSERTS_BASE, ACTIVE_FOLDER);
  const dstPath = path.join(INSERTS_BASE, targetName);
  if (!fs.existsSync(srcPath)) throw new Error('Working copy not found');
  if (!fs.existsSync(dstPath)) throw new Error(`Folder '${folderLabel(targetName)}' not found`);
  for (const f of fs.readdirSync(dstPath).filter(n => n.endsWith('.json'))) {
    fs.unlinkSync(path.join(dstPath, f));
  }
  for (const f of fs.readdirSync(srcPath).filter(n => n.endsWith('.json'))) {
    fs.copyFileSync(path.join(srcPath, f), path.join(dstPath, f));
  }
}

// ── snapshot ──────────────────────────────────────────────────────────────────

/**
 * Copy temp-local-inserts to temp-local-inserts-<name>.
 * Returns the new folder name.
 */
export function createSnapshot(name) {
  const slug = safeSlug(name);
  if (!slug) throw new Error('Snapshot name is invalid');
  const snapName = `${INSERT_PREFIX}-${slug}`;
  const snapPath = path.join(INSERTS_BASE, snapName);
  const activePath = path.join(INSERTS_BASE, ACTIVE_FOLDER);

  if (fs.existsSync(snapPath)) throw new Error(`Folder '${snapName}' already exists`);
  if (!fs.existsSync(activePath)) throw new Error(`Active folder '${ACTIVE_FOLDER}' does not exist`);

  fs.cpSync(activePath, snapPath, { recursive: true });
  return snapName;
}

// ── delete ────────────────────────────────────────────────────────────────────

/**
 * Permanently delete a named inserts folder (never the active one).
 */
export function deleteFolder(folderName) {
  if (folderName === ACTIVE_FOLDER) throw new Error('Cannot delete the working copy');
  if (folderName === getLoadedFolder()) throw new Error('Cannot delete the loaded folder — load another folder first');
  if (!folderName.startsWith(INSERT_PREFIX)) throw new Error(`Refusing: '${folderName}' is not a valid branch`);
  const folderPath = path.join(INSERTS_BASE, folderName);
  if (!fs.existsSync(folderPath)) throw new Error(`Folder '${folderName}' does not exist`);
  fs.rmSync(folderPath, { recursive: true, force: true });
  return `Deleted '${folderName}'`;
}

// ── move items ────────────────────────────────────────────────────────────────

/**
 * Move items (by UUID set) from src/typeName.json to dst/typeName.json.
 * Both src and dst must be temp-local-inserts* folders.
 * Returns { moved, skipped, message }.
 */
export function moveItems(uuidSet, srcName, dstName, typeName) {
  if (!srcName.startsWith(INSERT_PREFIX)) throw new Error(`Source '${srcName}' is not valid`);
  if (!dstName.startsWith(INSERT_PREFIX)) throw new Error(`Destination '${dstName}' is not valid`);

  const srcFile = path.join(INSERTS_BASE, srcName, `${typeName}.json`);
  const dstFile = path.join(INSERTS_BASE, dstName, `${typeName}.json`);

  const srcAll = readJson(srcFile) ?? [];
  const dstAll = readJson(dstFile) ?? [];

  const toMove = srcAll.filter(item => uuidSet.has(item.uuid));
  const remaining = srcAll.filter(item => !uuidSet.has(item.uuid));

  if (!toMove.length) return { moved: 0, skipped: 0, message: 'No matching items found' };

  const dstUuids = new Set(dstAll.map(i => i.uuid));
  const newItems = toMove.filter(i => !dstUuids.has(i.uuid));
  const skipped = toMove.length - newItems.length;

  fs.mkdirSync(path.join(INSERTS_BASE, dstName), { recursive: true });
  writeJson(srcFile, remaining);
  writeJson(dstFile, [...dstAll, ...newItems]);

  const moved = newItems.length;
  let message = `Moved ${moved} item${moved !== 1 ? 's' : ''} → '${dstName}/${typeName}.json'`;
  if (skipped) message += ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)`;
  return { moved, skipped, message };
}

// ── diff ──────────────────────────────────────────────────────────────────────

/**
 * Type-level diff between two folder names.
 * Returns array of { type, countA, countB, added, removed, same }.
 */
export function computeDiff(nameA, nameB) {
  const a = loadFolder(nameA) ?? { types: [] };
  const b = loadFolder(nameB) ?? { types: [] };

  const allTypes = [...new Set([...a.types.map(t => t.name), ...b.types.map(t => t.name)])].sort();

  return allTypes.map(type => {
    const ta = a.types.find(t => t.name === type);
    const tb = b.types.find(t => t.name === type);
    const ua = new Set(ta?.items.map(i => i.uuid) ?? []);
    const ub = new Set(tb?.items.map(i => i.uuid) ?? []);
    const added = [...ub].filter(u => !ua.has(u)).length;
    const removed = [...ua].filter(u => !ub.has(u)).length;
    const same = [...ua].filter(u => ub.has(u)).length;
    return { type, countA: ua.size, countB: ub.size, added, removed, same };
  });
}

// ── history ───────────────────────────────────────────────────────────────────

function _recordHistory(from, to) {
  const dir = path.dirname(HISTORY_FILE);
  fs.mkdirSync(dir, { recursive: true });
  let history = readJson(HISTORY_FILE) ?? [];
  history.push({ ts: new Date().toISOString().slice(0, 19), from, to });
  history = history.slice(-100);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}
