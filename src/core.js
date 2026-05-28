/**
 * core.js — data operations for imc
 * All reads/writes are synchronous; only touches temp-local-inserts* directories.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  return { name: folderName, path: folderPath, types, totalItems, isActive: folderName === ACTIVE_FOLDER };
}

/**
 * Load all temp-local-inserts* directories. Active folder is always first.
 */
export function loadAllFolders() {
  if (!fs.existsSync(INSERTS_BASE)) return [];

  const entries = fs.readdirSync(INSERTS_BASE, { withFileTypes: true });
  const names = entries
    .filter(e => e.isDirectory() && e.name.startsWith(INSERT_PREFIX))
    .map(e => e.name)
    .sort();

  const folders = names.map(loadFolder).filter(Boolean);
  const active = folders.filter(f => f.isActive);
  const others = folders.filter(f => !f.isActive);
  return [...active, ...others];
}

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Replace temp-local-inserts contents with target folder contents.
 * Optionally saves the current active state as a named snapshot first.
 * Returns a status string on success; throws on failure.
 */
export function activateFolder(targetName, saveCurrentAs) {
  if (targetName === ACTIVE_FOLDER) return 'Already the active folder.';

  const activePath = path.join(INSERTS_BASE, ACTIVE_FOLDER);
  const targetPath = path.join(INSERTS_BASE, targetName);

  if (!fs.existsSync(targetPath)) throw new Error(`Folder '${targetName}' not found`);
  if (!targetName.startsWith(INSERT_PREFIX)) throw new Error(`Refusing to activate '${targetName}': not a temp-local-inserts folder`);

  fs.mkdirSync(activePath, { recursive: true });

  if (saveCurrentAs) {
    const slug = safeSlug(saveCurrentAs);
    if (!slug) throw new Error('Snapshot name is invalid');
    const snapName = `${INSERT_PREFIX}-${slug}`;
    const snapPath = path.join(INSERTS_BASE, snapName);
    if (fs.existsSync(snapPath)) throw new Error(`Folder '${snapName}' already exists`);
    fs.cpSync(activePath, snapPath, { recursive: true });
  }

  // Clear active and copy from target
  for (const f of fs.readdirSync(activePath).filter(n => n.endsWith('.json'))) {
    fs.unlinkSync(path.join(activePath, f));
  }
  let copied = 0;
  for (const f of fs.readdirSync(targetPath).filter(n => n.endsWith('.json'))) {
    fs.copyFileSync(path.join(targetPath, f), path.join(activePath, f));
    copied++;
  }

  _recordHistory(ACTIVE_FOLDER, targetName);

  let msg = `Activated '${targetName}' (${copied} file${copied !== 1 ? 's' : ''})`;
  if (saveCurrentAs) msg += ` — previous state saved as '${INSERT_PREFIX}-${safeSlug(saveCurrentAs)}'`;
  return msg;
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
  if (folderName === ACTIVE_FOLDER) throw new Error('Cannot delete the active folder');
  if (!folderName.startsWith(INSERT_PREFIX)) throw new Error(`Refusing: '${folderName}' is not a temp-local-inserts folder`);
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
