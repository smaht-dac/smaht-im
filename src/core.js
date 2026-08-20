/**
 * core.js — data operations for imc
 * All reads/writes are synchronous; only touches temp-local-inserts* directories.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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

// Branches (temp-local-inserts-<slug>) live here, outside the portal checkout —
// only the literal working copy (ACTIVE_FOLDER) needs to live inside INSERTS_BASE,
// since that's the one the portal/tests actually read. See resolveFolderPath below.
export const BRANCHES_BASE = path.join(os.homedir(), '.smaht-im', 'branches');

const HISTORY_FILE = path.join(os.homedir(), '.smaht-im', 'activation-history.json');
const HEAD_FILE     = path.join(os.homedir(), '.smaht-im', 'HEAD');

/**
 * Resolve a folder name to its on-disk directory. The literal working copy
 * (ACTIVE_FOLDER, exactly 'temp-local-inserts') lives inside the portal
 * checkout (INSERTS_BASE) — the portal reads it directly and it must stay
 * there. Every other temp-local-inserts-<slug> BRANCH — including one that
 * happens to be the currently *loaded* branch — lives in BRANCHES_BASE.
 * Existing startsWith(INSERT_PREFIX) guards in each caller stay exactly
 * where they are and run BEFORE this is called.
 */
function resolveFolderPath(name) {
  return name === ACTIVE_FOLDER
    ? path.join(INSERTS_BASE, name)
    : path.join(BRANCHES_BASE, name);
}

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
  const folderPath = resolveFolderPath(folderName);
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
 * True if temp-local-inserts has exactly the same JSON files (by name + size)
 * as the given named folder. Used to detect external changes.
 */
function workingCopyMatchesFolder(folderName) {
  const activePath = resolveFolderPath(ACTIVE_FOLDER);
  const folderPath = resolveFolderPath(folderName);
  if (!fs.existsSync(folderPath)) return false;
  const toMap = (dir) => new Map(
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => [f, fs.statSync(path.join(dir, f)).size]),
  );
  const aMap = toMap(activePath);
  const fMap = toMap(folderPath);
  if (aMap.size !== fMap.size) return false;
  for (const [file, size] of aMap) { if (fMap.get(file) !== size) return false; }
  return true;
}

/**
 * If `folderName` is a BRANCH that also happens to be the currently loaded
 * folder, mirror its on-disk content into the working copy. Every function
 * below that mutates a named folder in place (sync, pull-more, item sync,
 * restore, move) writes only to that folder's own directory via
 * resolveFolderPath — never to temp-local-inserts — so without this, syncing
 * the loaded folder leaves the working copy holding stale pre-sync data.
 * The very next loadAllFolders() then sees that mismatch and treats it as an
 * external edit, auto-snapshotting the STALE data into a spurious new folder
 * (see the auto-snapshot-on-divergence comment on loadAllFolders below).
 */
function refreshWorkingCopyIfActive(folderName) {
  if (folderName === ACTIVE_FOLDER) return;
  if (getLoadedFolder() !== folderName) return;
  const srcPath = resolveFolderPath(folderName);
  const dstPath = resolveFolderPath(ACTIVE_FOLDER);
  fs.mkdirSync(dstPath, { recursive: true });
  for (const f of fs.readdirSync(dstPath).filter(n => n.endsWith('.json'))) {
    fs.unlinkSync(path.join(dstPath, f));
  }
  for (const f of fs.readdirSync(srcPath).filter(n => n.endsWith('.json'))) {
    fs.copyFileSync(path.join(srcPath, f), path.join(dstPath, f));
  }
}

/** Generate a unique folder name based on the current local date-time. */
function timestampFolderName() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  const base = `${INSERT_PREFIX}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  if (!fs.existsSync(resolveFolderPath(base))) return base;
  for (let i = 2; i < 100; i++) {
    const c = `${base}-${i}`;
    if (!fs.existsSync(resolveFolderPath(c))) return c;
  }
  return base;
}

/**
 * Load all inserts folders (excludes the working copy temp-local-inserts).
 * On first run, bootstraps a 'main' folder from the working copy.
 * On every load, if temp-local-inserts has data that doesn't match the
 * loaded folder, a new timestamped folder is created from it automatically.
 * The loaded folder (from HEAD) is always first; others sorted by recency.
 */
export function loadAllFolders() {
  if (!fs.existsSync(INSERTS_BASE)) return [];

  // Branches live in BRANCHES_BASE, not INSERTS_BASE — lazy-create it, since
  // readdirSync (unlike cpSync elsewhere in this function) throws if missing.
  fs.mkdirSync(BRANCHES_BASE, { recursive: true });
  const entries = fs.readdirSync(BRANCHES_BASE, { withFileTypes: true });
  let names = entries
    .filter(e => e.isDirectory() && e.name.startsWith(INSERT_PREFIX) && e.name !== ACTIVE_FOLDER)
    .map(e => e.name)
    .sort();

  const activePath = resolveFolderPath(ACTIVE_FOLDER);
  const workingHasData = fs.existsSync(activePath) &&
    fs.readdirSync(activePath).some(f => f.endsWith('.json'));

  // Bootstrap: no folders yet — create 'main' from the working copy
  if (names.length === 0 && workingHasData) {
    const mainName = `${INSERT_PREFIX}-main`;
    fs.cpSync(activePath, resolveFolderPath(mainName), { recursive: true });
    names = [mainName];
  }

  // Resolve HEAD; fall back to first folder if HEAD is missing or stale
  let active = getLoadedFolder();
  if (!active || !names.includes(active)) {
    active = names[0] ?? null;
    if (active) setLoadedFolder(active);
  }

  // If temp-local-inserts has data that differs from the loaded folder,
  // snapshot it into a new timestamped folder and make that the loaded one.
  if (workingHasData && (!active || !workingCopyMatchesFolder(active))) {
    const newName = timestampFolderName();
    fs.cpSync(activePath, resolveFolderPath(newName), { recursive: true });
    names.push(newName);
    setLoadedFolder(newName);
    active = newName;
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

  const activePath = resolveFolderPath(ACTIVE_FOLDER);
  const targetPath = resolveFolderPath(targetName);

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
 * Create a new branch: empty (a single placeholder empty-array file — see
 * inline comment below for why not zero files) if no baseBranch is given,
 * otherwise a copy of baseBranch's json files.
 * Returns the full folder name (INSERT_PREFIX + '-' + slug).
 */
export function createFolder(name, baseBranch = null) {
  const slug = safeSlug(name);
  if (!slug) throw new Error('Folder name is invalid');
  const fullName = `${INSERT_PREFIX}-${slug}`;
  const newPath  = resolveFolderPath(fullName);

  if (fs.existsSync(newPath)) throw new Error(`Folder '${slug}' already exists`);
  fs.mkdirSync(newPath, { recursive: true });

  if (baseBranch) {
    const basePath = resolveFolderPath(baseBranch);
    if (!fs.existsSync(basePath)) throw new Error(`Base folder '${folderLabel(baseBranch)}' not found`);
    for (const f of fs.readdirSync(basePath).filter(n => n.endsWith('.json'))) {
      fs.copyFileSync(path.join(basePath, f), path.join(newPath, f));
    }
  } else {
    // A directory with zero .json files isn't actually "empty" once loaded —
    // snovault's load_local_data() only checks temp-local-inserts for *any*
    // .json file; find none, and it silently falls back to demo_inserts or
    // the real inserts/ fixtures instead (confirmed by reading loadxl.py).
    // One placeholder empty-array file satisfies that check and keeps this
    // folder genuinely empty. The type name doesn't matter (loadxl discovers
    // types dynamically; an empty list is a no-op regardless), but a real
    // registered type avoids relying on that for a type it's never checked.
    writeJson(path.join(newPath, 'donor.json'), []);
  }

  return fullName;
}

/**
 * Low-level spawn wrapper for update-inserts-from-server, shared by
 * pullFolderAsync (pulls into the default working copy) and syncFolderAsync
 * (re-pulls into a named folder via --dest).
 *
 * Auto-confirms the CLI's interactive whitelist prompt: it asks
 * "Continue? (y/n)" whenever --dest's basename isn't one of a handful of
 * common names, which is ALWAYS the case for temp-local-inserts-<slug>
 * branch folders. Since nothing ever answered that prompt, syncFolderAsync
 * hung forever on every real branch sync (verified). imc's destinations are
 * always programmatic and pre-validated, never a user typo, so answering
 * "y" unconditionally is correct here.
 *
 * opts: { env, query, dest } — dest omitted => CLI's own default (temp-local-inserts).
 * onLine(line)   — one call per stdout/stderr line, in arrival order.
 * onDone(result) — result = { success, killed, code, signal }; success is
 *                  always false when killed is true.
 * Returns { cmd, kill() } — kill() sends SIGTERM once; safe to call again.
 */
function spawnUpdateInsertsAsync({ env, query, dest }, onLine, onDone) {
  const args = ['--env', env, '--portal', 'smaht', '--search', query];
  if (dest) args.push('--dest', dest);
  const cmd = `update-inserts-from-server ${args.join(' ')}`;

  const child = spawn('update-inserts-from-server', args, {
    stdio: 'pipe',
    env: { ...process.env, PYENV_VERSION: 'smaht311' },
    cwd: REPO_ROOT,
  });
  child.stdin?.write('y\n');
  child.stdin?.end();

  let killedByUs = false;
  let buf = '';
  const flush = (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) { if (line.trim()) onLine(line.trim()); }
  };
  child.stdout?.on('data', flush);
  child.stderr?.on('data', flush);
  child.on('close', (code, signal) => {
    if (buf.trim()) onLine(buf.trim());
    onDone({ success: code === 0 && !killedByUs, killed: killedByUs, code, signal });
  });
  child.on('error', err => {
    onLine(`spawn error: ${err.message}`);
    onDone({ success: false, killed: killedByUs, code: null, signal: null });
  });

  return { cmd, kill() { killedByUs = true; child.kill('SIGTERM'); } };
}

/**
 * Run update-inserts-from-server without --dest so it writes to the default
 * temp-local-inserts (the working copy). The caller must switch to the target
 * folder first so that folder is the active working copy.
 *
 * onLine(line) is called for each output line as it arrives (live progress).
 * onDone(success, result) is called when the process exits.
 * Returns { cmd, kill() } — cmd is the user-facing command string for logging.
 */
export function pullFolderAsync(env, query, onLine, onDone) {
  return spawnUpdateInsertsAsync({ env, query }, onLine, (result) => onDone(result.success, result));
}

/**
 * Copy all JSON files from the working copy (temp-local-inserts) into a named
 * folder, replacing whatever was there. Used to persist a pull result.
 */
export function syncWorkingCopyToFolder(targetName) {
  const srcPath = resolveFolderPath(ACTIVE_FOLDER);
  const dstPath = resolveFolderPath(targetName);
  if (!fs.existsSync(srcPath)) throw new Error('Working copy not found');
  if (!fs.existsSync(dstPath)) throw new Error(`Folder '${folderLabel(targetName)}' not found`);
  for (const f of fs.readdirSync(dstPath).filter(n => n.endsWith('.json'))) {
    fs.unlinkSync(path.join(dstPath, f));
  }
  for (const f of fs.readdirSync(srcPath).filter(n => n.endsWith('.json'))) {
    fs.copyFileSync(path.join(srcPath, f), path.join(dstPath, f));
  }
}

// ── rename folder ─────────────────────────────────────────────────────────────

/**
 * Rename a named inserts folder. Updates HEAD if this was the loaded folder.
 * Returns the new full folder name.
 */
export function renameFolder(oldName, newSlug) {
  const slug = safeSlug(newSlug);
  if (!slug) throw new Error('Name is invalid');
  const newName = `${INSERT_PREFIX}-${slug}`;

  if (oldName === ACTIVE_FOLDER) throw new Error('Cannot rename the working copy');
  if (!oldName.startsWith(INSERT_PREFIX)) throw new Error(`'${oldName}' is not a valid folder`);
  if (newName === oldName) throw new Error('Name is unchanged');

  const oldPath = resolveFolderPath(oldName);
  const newPath = resolveFolderPath(newName);

  if (!fs.existsSync(oldPath)) throw new Error(`Folder '${folderLabel(oldName)}' not found`);
  if (fs.existsSync(newPath)) throw new Error(`'${slug}' already exists`);

  fs.renameSync(oldPath, newPath);

  if (getLoadedFolder() === oldName) setLoadedFolder(newName);

  return newName;
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
  const snapPath = resolveFolderPath(snapName);
  const activePath = resolveFolderPath(ACTIVE_FOLDER);

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
  const folderPath = resolveFolderPath(folderName);
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

  const srcFile = path.join(resolveFolderPath(srcName), `${typeName}.json`);
  const dstFile = path.join(resolveFolderPath(dstName), `${typeName}.json`);

  const srcAll = readJson(srcFile) ?? [];
  const dstAll = readJson(dstFile) ?? [];

  const toMove = srcAll.filter(item => uuidSet.has(item.uuid));
  const remaining = srcAll.filter(item => !uuidSet.has(item.uuid));

  if (!toMove.length) return { moved: 0, skipped: 0, message: 'No matching items found' };

  const dstUuids = new Set(dstAll.map(i => i.uuid));
  const newItems = toMove.filter(i => !dstUuids.has(i.uuid));
  const skipped = toMove.length - newItems.length;

  fs.mkdirSync(resolveFolderPath(dstName), { recursive: true });
  writeJson(srcFile, remaining);
  writeJson(dstFile, [...dstAll, ...newItems]);
  refreshWorkingCopyIfActive(srcName);
  refreshWorkingCopyIfActive(dstName);

  const moved = newItems.length;
  let message = `Moved ${moved} item${moved !== 1 ? 's' : ''} → '${dstName}/${typeName}.json'`;
  if (skipped) message += ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)`;
  return { moved, skipped, message };
}

// ── diff ──────────────────────────────────────────────────────────────────────

/**
 * Type-level diff between two already-loaded folder objects (as returned by
 * loadFolder). Shared by computeDiff (two named folders) and the sync/restore
 * "what changed" reporting (same folder, before vs after).
 * Returns array of { type, countA, countB, added, removed, same }.
 */
function diffFolderObjects(a, b) {
  const typesA = a?.types ?? [];
  const typesB = b?.types ?? [];
  const allTypes = [...new Set([...typesA.map(t => t.name), ...typesB.map(t => t.name)])].sort();

  return allTypes.map(type => {
    const ta = typesA.find(t => t.name === type);
    const tb = typesB.find(t => t.name === type);
    const ua = new Set(ta?.items.map(i => i.uuid) ?? []);
    const ub = new Set(tb?.items.map(i => i.uuid) ?? []);
    const added = [...ub].filter(u => !ua.has(u)).length;
    const removed = [...ua].filter(u => !ub.has(u)).length;
    const same = [...ua].filter(u => ub.has(u)).length;
    return { type, countA: ua.size, countB: ub.size, added, removed, same };
  });
}

/** Type-level diff between two folder names. See diffFolderObjects for the shape. */
export function computeDiff(nameA, nameB) {
  return diffFolderObjects(loadFolder(nameA) ?? { types: [] }, loadFolder(nameB) ?? { types: [] });
}

/** Shallow field-level diff between two item data objects. Returns [{ field, before, after }]. */
function diffItemFields(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const bv = before?.[key];
    const av = after?.[key];
    if (JSON.stringify(bv) !== JSON.stringify(av)) changes.push({ field: key, before: bv, after: av });
  }
  return changes;
}

// ── sync/tracking history & restore ────────────────────────────────────────────
//
// A safety net for syncFolderAsync/syncItemAsync: both overwrite a folder's
// JSON files from the portal, and UUID-set tracking can't tell you if an
// item's *contents* changed underneath you. Every such write is preceded by
// a backup stored outside INSERTS_BASE, so it never risks the write-guard
// invariant, and capped per folder so it can't grow without bound.

const BACKUPS_DIR = path.join(os.homedir(), '.smaht-im', 'backups');
const MAX_BACKUPS_PER_FOLDER = 10;
const BACKUP_META_FILE = '_meta.json'; // bookkeeping only — must never be copied back into a real folder

/**
 * Snapshot a folder's current JSON files before a sync/restore overwrites them.
 * Stored at ~/.smaht-im/backups/{folderName}/{id}/. Returns the backup id, or
 * null if the folder doesn't exist yet or has no JSON files to back up.
 */
export function backupFolder(folderName, reason) {
  const srcPath = resolveFolderPath(folderName);
  if (!fs.existsSync(srcPath)) return null;
  const files = fs.readdirSync(srcPath).filter(f => f.endsWith('.json') && f !== BACKUP_META_FILE);
  if (files.length === 0) return null;

  // Random suffix guards against same-millisecond collisions silently clobbering
  // an earlier backup (e.g. rapid successive syncs).
  const id  = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(BACKUPS_DIR, folderName, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(srcPath, f), path.join(dir, f));
  writeJson(path.join(dir, BACKUP_META_FILE), { reason, ts: new Date().toISOString() });

  _pruneBackups(folderName);
  return id;
}

/** Keep only the most recent MAX_BACKUPS_PER_FOLDER backups for a folder. */
function _pruneBackups(folderName) {
  const dir = path.join(BACKUPS_DIR, folderName);
  if (!fs.existsSync(dir)) return;
  const ids = fs.readdirSync(dir).sort(); // ids are ISO-based, so lexical sort is chronological
  const excess = ids.length - MAX_BACKUPS_PER_FOLDER;
  if (excess <= 0) return; // negative/zero excess must NOT reach slice(): a negative end index
                            // counts from the array's end, not "nothing to remove"
  for (const id of ids.slice(0, excess)) {
    fs.rmSync(path.join(dir, id), { recursive: true, force: true });
  }
}

/** List backups for a folder, newest first: [{ id, reason, ts }]. */
export function listBackups(folderName) {
  const dir = path.join(BACKUPS_DIR, folderName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map(id => {
      const meta = readJson(path.join(dir, id, BACKUP_META_FILE)) ?? {};
      return { id, reason: meta.reason ?? '', ts: meta.ts ?? id };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Restore a folder's JSON files from one of its backups, replacing whatever
 * is currently there. The current state is itself backed up first, so a
 * restore is never a dead end. Returns a status string; throws on failure.
 */
export function restoreBackup(folderName, backupId) {
  if (!folderName.startsWith(INSERT_PREFIX)) throw new Error(`'${folderName}' is not a valid folder`);
  const backupDir = path.join(BACKUPS_DIR, folderName, backupId);
  if (!fs.existsSync(backupDir)) throw new Error('Backup not found');

  backupFolder(folderName, `before restoring ${backupId}`);

  const destPath = resolveFolderPath(folderName);
  fs.mkdirSync(destPath, { recursive: true });
  for (const f of fs.readdirSync(destPath).filter(n => n.endsWith('.json'))) {
    fs.unlinkSync(path.join(destPath, f));
  }
  for (const f of fs.readdirSync(backupDir).filter(n => n.endsWith('.json') && n !== BACKUP_META_FILE)) {
    fs.copyFileSync(path.join(backupDir, f), path.join(destPath, f));
  }
  refreshWorkingCopyIfActive(folderName);
  return `Restored '${folderLabel(folderName)}' to backup from ${backupId}`;
}

// ── remote tracking ───────────────────────────────────────────────────────────

const META_DIR  = path.join(os.homedir(), '.smaht-im');
const KEYS_FILE = path.join(os.homedir(), '.smaht-keys.json');

/** Read ~/.smaht-im/{folderName}.json (written by im.py). Returns {} if missing. */
export function loadBranchMeta(folderName) {
  try { return JSON.parse(fs.readFileSync(path.join(META_DIR, `${folderName}.json`), 'utf8')); }
  catch { return {}; }
}

/** Merge updates into ~/.smaht-im/{folderName}.json. */
export function saveBranchMeta(folderName, updates) {
  const file = path.join(META_DIR, `${folderName}.json`);
  const merged = { ...loadBranchMeta(folderName), ...updates };
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
}

/**
 * Distinct portal envs a folder's data came from, newest-pull first.
 * Per-type entries can each carry a different env (data pulled from one env,
 * more added from another later), so this is a set, not a single value.
 */
export function getFolderEnvs(folderName) {
  const meta = loadBranchMeta(folderName);
  const entries = Object.entries(meta)
    .filter(([key]) => !key.startsWith('__'))
    .filter(([, v]) => v && v.env);
  entries.sort((a, b) => new Date(b[1].last_pulled || 0) - new Date(a[1].last_pulled || 0));
  const envs = [...new Set(entries.map(([, v]) => v.env))];
  if (envs.length === 0 && meta.__tracking__?.env) envs.push(meta.__tracking__.env);
  return envs;
}

/**
 * The effective tracking entry for a folder: the first per-type entry
 * written by im.py if one exists, else the manual __tracking__ entry set
 * via `t` or on folder creation. Returns null if neither exists.
 */
export function getFolderTracking(folderName) {
  const meta = loadBranchMeta(folderName);
  const typeKeys = Object.keys(meta).filter(k => !k.startsWith('__'));
  const entry = typeKeys.length > 0 ? meta[typeKeys[0]] : meta.__tracking__;
  return entry ?? null;
}

/**
 * Return { key, secret, server } for env from ~/.smaht-keys.json, or null.
 * The server field is the full base URL (e.g. "https://data.smaht.org").
 */
export function loadEnvAuth(env) {
  try {
    const entry = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'))[env];
    return entry?.key && entry?.secret && entry?.server ? entry : null;
  } catch { return null; }
}

/**
 * Background UUID-set staleness check for one folder.
 * Reads the im.py manifest (or __tracking__ key set via SetQueryModal).
 * Respects a 5-min TTL cached in __remote_cache__.
 * Calls onProgress({ status, behind, ahead, error }) when done.
 */
export function checkRemoteAsync(folderName, onProgress) {
  const meta = loadBranchMeta(folderName);
  let typeKeys = Object.keys(meta).filter(k => !k.startsWith('__'));

  // Fall back to __tracking__ when there are no im.py per-type entries
  if (typeKeys.length === 0) {
    if (!meta.__tracking__?.query) { onProgress({ status: 'untracked' }); return; }
    typeKeys = ['__tracking__'];
  }

  // TTL: 5 min
  const cache = meta.__remote_cache__;
  if (cache?.checked_at) {
    const age = Date.now() - new Date(cache.checked_at).getTime();
    if (age < 5 * 60 * 1000) {
      onProgress({ status: cache.error ? 'error' : 'ok', behind: cache.behind ?? 0, ahead: cache.ahead ?? 0, error: cache.error ?? null });
      return;
    }
  }

  const folder = loadFolder(folderName);
  const localByType = {};
  for (const t of folder?.types ?? []) {
    localByType[t.name] = new Set(t.items.map(i => i.uuid).filter(Boolean));
  }
  const allLocal = new Set(Object.values(localByType).flatMap(s => [...s]));

  const checks = typeKeys.map(async (typeName) => {
    const isTracking = typeName === '__tracking__';
    const entry      = isTracking ? meta.__tracking__ : meta[typeName];
    const env        = entry?.env ?? 'data';
    const query      = entry?.query ?? '';
    const auth       = loadEnvAuth(env);
    if (!auth) throw new Error(`No credentials for env '${env}'`);

    const qs  = query.startsWith('?') ? query.slice(1) : query;
    const url = `${auth.server.replace(/\/$/, '')}/search/?${qs}&field=uuid&limit=all`;
    const hdr = { Authorization: `Basic ${Buffer.from(`${auth.key}:${auth.secret}`).toString('base64')}` };
    const res = await fetch(url, { headers: hdr });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${isTracking ? 'combined' : typeName}`);

    const remoteUuids = new Set((await res.json())['@graph']?.map(i => i.uuid).filter(Boolean) ?? []);
    const local = isTracking ? allLocal : (localByType[typeName] ?? new Set());
    return {
      behind: [...remoteUuids].filter(u => !local.has(u)).length,
      ahead:  [...local].filter(u => !remoteUuids.has(u)).length,
    };
  });

  Promise.allSettled(checks).then(results => {
    let behind = 0, ahead = 0, error = null;
    for (const r of results) {
      if (r.status === 'fulfilled') { behind += r.value.behind; ahead += r.value.ahead; }
      else error = r.reason?.message ?? 'Check failed';
    }
    saveBranchMeta(folderName, { __remote_cache__: { checked_at: new Date().toISOString(), behind, ahead, error } });
    onProgress({ status: error ? 'error' : 'ok', behind, ahead, error });
  });
}

/**
 * Re-pull all tracked types for a named folder directly (not through the working copy),
 * using the folder's stored tracking query (see setQuery / `t`). The folder is backed
 * up first, so a bad sync is always recoverable via restoreBackup.
 * onLine(line) streams progress as it arrives, same as pullFolderAsync.
 * Calls onDone(success, message, diff, result) when complete — diff is the type-level
 * before/after change list (see diffFolderObjects), or null if it can't be computed.
 * Returns { cmd, kill() } so the caller can cancel an in-flight sync.
 */
export function syncFolderAsync(folderName, onLine, onDone) {
  const entry    = getFolderTracking(folderName);
  const env      = entry?.env ?? 'data';
  const query    = entry?.query ?? '';
  if (!query) { onDone(false, 'No tracking query — press t to set one', null, {}); return { cmd: null, kill() {} }; }

  const before = loadFolder(folderName);
  backupFolder(folderName, 'before folder sync');

  const folderPath = resolveFolderPath(folderName);
  return spawnUpdateInsertsAsync({ env, query, dest: folderPath }, onLine, (result) => {
    if (result.success) {
      saveBranchMeta(folderName, { __remote_cache__: null });
      refreshWorkingCopyIfActive(folderName);
    }
    const diff = result.success ? diffFolderObjects(before, loadFolder(folderName)) : null;
    const msg  = result.killed ? 'Sync cancelled' : (result.success ? 'Sync complete' : 'Sync failed');
    onDone(result.success, msg, diff, result);
  });
}

/**
 * Run one or more one-off queries sequentially against an existing folder,
 * without changing the folder's stored tracking query. update-inserts-from-server
 * merges into what's already there rather than replacing it, so this is
 * purely additive — useful for combinations the portal's own search can't
 * express as a single query (e.g. two disjoint OR-groups run back to back).
 *
 * Deliberately does NOT back the folder up first — unlike syncFolderAsync,
 * this is a routine, frequent, purely-additive action; a mandatory backup on
 * every call would flood the per-folder cap (10) with "add more" snapshots
 * that crowd out more meaningful history. If something goes wrong, whatever
 * was already backed up via syncFolderAsync/restore remains in History (`H`)
 * exactly as before — this path just doesn't add to it.
 *
 * Runs queries in order; stops at the first failure rather than skipping
 * past it (so you always know exactly how far it got). Computes ONE
 * before/after diff across the whole batch, not one per query.
 *
 * onQuery(index, total, query) fires right before each query starts.
 * onLine(line) streams output for whichever query is currently running.
 * onDone(result) fires once, after the batch stops (success, failure, or
 * cancel): { success, killed, ranCount, totalCount, failedQuery, diff }.
 * Returns { kill() } — kills whichever query is currently in flight; the
 * batch stops there (no further queries run).
 */
export function pullBatchIntoFolderAsync(folderName, env, queries, onQuery, onLine, onDone) {
  const list = (queries ?? []).map(q => q?.trim()).filter(Boolean);
  if (list.length === 0) {
    onDone({ success: false, killed: false, ranCount: 0, totalCount: 0, failedQuery: null, diff: null });
    return { kill() {} };
  }

  const before = loadFolder(folderName);
  const folderPath = resolveFolderPath(folderName);
  let currentKill = () => {};

  const runAt = (i) => {
    onQuery(i, list.length, list[i]);
    const { kill } = spawnUpdateInsertsAsync({ env, query: list[i], dest: folderPath }, onLine, (result) => {
      if (!result.success) {
        // Earlier queries in the batch may have already merged data into
        // folderPath before this one failed — refresh regardless of i.
        refreshWorkingCopyIfActive(folderName);
        const diff = diffFolderObjects(before, loadFolder(folderName));
        onDone({ success: false, killed: result.killed, ranCount: i, totalCount: list.length, failedQuery: list[i], diff });
        return;
      }
      if (i + 1 < list.length) {
        runAt(i + 1);
        return;
      }
      saveBranchMeta(folderName, { __remote_cache__: null });
      refreshWorkingCopyIfActive(folderName);
      const diff = diffFolderObjects(before, loadFolder(folderName));
      onDone({ success: true, killed: false, ranCount: list.length, totalCount: list.length, failedQuery: null, diff });
    });
    currentKill = kill;
  };

  runAt(0);
  return { kill: () => currentKill() };
}

/**
 * Fetch a single item from the portal and replace its entry in the local JSON file.
 * Works on any branch folder (not just the active one). The folder is backed up
 * first, so the replaced item is always recoverable via restoreBackup.
 * Calls onDone(success, message, changes) when complete — changes is the
 * field-level before/after diff (see diffItemFields), or null on failure.
 */
export function syncItemAsync(folderName, typeName, uuid, env, onDone) {
  const auth = loadEnvAuth(env);
  if (!auth) { onDone(false, `No credentials for env '${env}'`, null); return; }

  const url = `${auth.server.replace(/\/$/, '')}/search/?uuid=${uuid}&limit=1`;
  const hdr = { Authorization: `Basic ${Buffer.from(`${auth.key}:${auth.secret}`).toString('base64')}` };

  fetch(url, { headers: hdr })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      const fresh = (data['@graph'] ?? [])[0];
      if (!fresh) throw new Error('Item not found in portal');
      const filePath = path.join(resolveFolderPath(folderName), `${typeName}.json`);
      const items = readJson(filePath) ?? [];
      const idx = items.findIndex(i => i.uuid === uuid);
      if (idx === -1) throw new Error('UUID not found in local file');

      backupFolder(folderName, `before item sync: ${typeName}/${uuid}`);

      const before = items[idx];
      items[idx] = fresh;
      writeJson(filePath, items);
      refreshWorkingCopyIfActive(folderName);

      onDone(true, `Item refreshed from ${env} portal`, diffItemFields(before, fresh));
    })
    .catch(err => onDone(false, err.message, null));
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

// ── error log ─────────────────────────────────────────────────────────────────

export const LOG_FILE = path.join(os.homedir(), '.smaht-im', 'imc.log');
const LOG_LINES = 500; // small on-disk history — at typical entry length this stays well under ~100 KB

/** Append a timestamped entry to ~/.smaht-im/imc.log, trimming to the last LOG_LINES lines. */
export function appendLog(message) {
  const dir = path.dirname(LOG_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19); // matches _recordHistory's stamp format
  const newLines = message.split('\n').map(line => `[${stamp}] ${line}`);
  let existing = [];
  try { existing = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean); } catch {}
  const trimmed = [...existing, ...newLines].slice(-LOG_LINES);
  fs.writeFileSync(LOG_FILE, trimmed.join('\n') + '\n');
}

/** Read the persisted log file as an array of lines (oldest first). Returns [] if missing. */
export function readLogFile() {
  try { return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean); }
  catch { return []; }
}

// ── anonymized export ─────────────────────────────────────────────────────────
//
// Produces a de-identified COPY of a temp-local-inserts* folder for sharing
// outside the team (bug reports, example data, etc.). Only ever runs when a
// caller explicitly asks for it — imc's 'Export anonymized copy' keybinding,
// or the standalone `scripts/anonymize-inserts.js` CLI, which is a thin
// wrapper around anonymizeFolder() below so both entry points share one
// implementation. Nothing else in this file calls it.
//
// This is a generic heuristic, not a compliance sign-off — see the README
// section "Sharing inserts data safely" for what it does and does not cover.

const EXPORT_DIR = path.join(os.homedir(), 'smaht-im-exports');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Default field policy for anonymizeFolder(). Review against the real
 *  schema before trusting it for anything you plan to actually share. */
export const ANONYMIZE_DEFAULT_POLICY = {
  scrub: [
    'submitted_id', 'external_id', 'identifier', 'identifiers', 'aliases',
    'alias', 'description', 'notes', 'comment', 'comments', 'submitted_by',
    'notes_to_dcc', 'consent_id', 'protocol_id', 'contact', 'email',
  ],
  fakeSequential: ['accession'],
  jitterDates: [
    'date_created', 'last_modified', 'submitted_date', 'date_collected',
    'date_obtained', 'date_of_death',
  ],
  shuffleAcrossRecords: [
    'age', 'age_at_death', 'sex', 'gender', 'race', 'ethnicity',
    'cause_of_death', 'height', 'weight', 'bmi', 'ancestry',
    'tissue_type', 'collection_site',
  ],
  minGroupSizeForShuffle: 5,
};

/** Seeded PRNG (mulberry32) — same seed always produces the same output. */
function makeRng(seed) {
  if (!seed) return Math.random;
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return function rng() {
    h |= 0; h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeUuid(rng) {
  const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = bytes.map(b => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function shuffleArr(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Recursively remap any UUID-shaped string found anywhere in a value. */
function remapUuidsDeep(value, uuidMap) {
  if (typeof value === 'string') {
    return UUID_RE.test(value) ? (uuidMap.get(value.toLowerCase()) ?? value) : value;
  }
  if (Array.isArray(value)) return value.map(v => remapUuidsDeep(v, uuidMap));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapUuidsDeep(v, uuidMap);
    return out;
  }
  return value;
}

function collectUuids(value, into) {
  if (typeof value === 'string' && UUID_RE.test(value)) into.add(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach(v => collectUuids(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectUuids(v, into));
}

function jitterDateString(str, days, rng) {
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  const offsetMs = Math.round((rng() * 2 - 1) * days * 86_400_000);
  const shifted = new Date(d.getTime() + offsetMs);
  return /^\d{4}-\d{2}-\d{2}$/.test(str)
    ? shifted.toISOString().slice(0, 10)
    : shifted.toISOString().replace('Z', '+00:00');
}

/**
 * Produce a de-identified copy of a temp-local-inserts* folder.
 *
 * Writes to opts.outDir if given (must not already exist and be non-empty),
 * otherwise to a fresh timestamped directory under ~/smaht-im-exports/ —
 * NEVER inside INSERTS_BASE, so an export can never be mistaken for a
 * working branch and never needs the INSERT_PREFIX write guard.
 *
 * opts: { outDir, destName, seed, jitterDays = 30, policy = ANONYMIZE_DEFAULT_POLICY }
 * Returns { outDir, report }. Throws on bad input.
 */
export function anonymizeFolder(sourceName, opts = {}) {
  if (!sourceName.startsWith(INSERT_PREFIX)) {
    throw new Error(`'${sourceName}' is not a valid inserts folder`);
  }
  const sourcePath = resolveFolderPath(sourceName);
  if (!fs.existsSync(sourcePath)) throw new Error(`Folder '${folderLabel(sourceName)}' not found`);

  const policy     = opts.policy ?? ANONYMIZE_DEFAULT_POLICY;
  const jitterDays = opts.jitterDays ?? 30;
  const rng        = makeRng(opts.seed);

  let outDir;
  if (opts.outDir) {
    outDir = opts.outDir;
    if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
      throw new Error(`Output dir already exists and is not empty: ${outDir}`);
    }
  } else {
    const label = safeSlug(opts.destName || `${folderLabel(sourceName)}-anon`) || 'anon-export';
    outDir = path.join(EXPORT_DIR, `${label}-${Date.now()}`);
    if (fs.existsSync(outDir)) outDir = `${outDir}-${crypto.randomBytes(3).toString('hex')}`;
  }
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(sourcePath).filter(f => f.endsWith('.json')).sort();
  const byType = {};
  for (const f of files) byType[f.replace(/\.json$/, '')] = readJson(path.join(sourcePath, f)) ?? [];

  // Pass 1 — collect every UUID in the whole folder, build one global remap
  // so referential integrity (sample.donor === donor.uuid) survives.
  const seen = new Set();
  for (const records of Object.values(byType)) collectUuids(records, seen);
  const uuidMap = new Map();
  for (const u of seen) uuidMap.set(u, fakeUuid(rng));

  const scrubSet    = new Set(policy.scrub.map(s => s.toLowerCase()));
  const fakeSeqSet  = new Set(policy.fakeSequential.map(s => s.toLowerCase()));
  const jitterSet   = new Set(policy.jitterDates.map(s => s.toLowerCase()));
  const shuffleSet  = new Set(policy.shuffleAcrossRecords.map(s => s.toLowerCase()));
  const minGroup    = policy.minGroupSizeForShuffle ?? 5;

  const report = {
    generatedFrom: sourceName,
    generatedAt: new Date().toISOString(),
    seed: opts.seed ?? '(random — not reproducible)',
    types: {},
  };

  for (const [typeName, records] of Object.entries(byType)) {
    const typeReport = { scrubbed: new Set(), faked: new Set(), jittered: new Set(), shuffled: [], skippedShuffle: [] };
    const seqCounters = {};

    // Pass 2 — per-field scrub / fake / jitter, plus uuid remap, record by record.
    const pass2 = records.map(rec => {
      const remapped = remapUuidsDeep(rec, uuidMap);
      for (const [key, val] of Object.entries(remapped)) {
        const lk = key.toLowerCase();
        if (val == null) continue;
        if (scrubSet.has(lk)) {
          remapped[key] = '[redacted]';
          typeReport.scrubbed.add(key);
        } else if (fakeSeqSet.has(lk)) {
          seqCounters[key] = (seqCounters[key] ?? 0) + 1;
          remapped[key] = `ANON-${typeName.toUpperCase()}-${String(seqCounters[key]).padStart(4, '0')}`;
          typeReport.faked.add(key);
        } else if (jitterSet.has(lk) && typeof val === 'string') {
          remapped[key] = jitterDateString(val, jitterDays, rng);
          typeReport.jittered.add(key);
        }
      }
      return remapped;
    });

    // Pass 3 — shuffle quasi-identifier columns across records of this type.
    for (const field of shuffleSet) {
      const actualKey = Object.keys(pass2[0] ?? {}).find(k => k.toLowerCase() === field);
      if (!actualKey) continue;
      const present = pass2.filter(r => r[actualKey] != null);
      if (present.length < minGroup) {
        // Too few records to shuffle meaningfully — redact instead of
        // silently "protecting" by permuting a handful of values.
        for (const r of pass2) if (r[actualKey] != null) r[actualKey] = '[redacted-small-group]';
        typeReport.skippedShuffle.push({ field: actualKey, count: present.length });
        continue;
      }
      const values = shuffleArr(present.map(r => r[actualKey]), rng);
      present.forEach((r, i) => { r[actualKey] = values[i]; });
      typeReport.shuffled.push(actualKey);
    }

    writeJson(path.join(outDir, `${typeName}.json`), pass2);
    report.types[typeName] = {
      recordCount: records.length,
      scrubbedFields: [...typeReport.scrubbed],
      fakedFields: [...typeReport.faked],
      jitteredDateFields: [...typeReport.jittered],
      shuffledFields: typeReport.shuffled,
      shuffleSkippedTooSmall: typeReport.skippedShuffle,
    };
  }

  writeJson(path.join(outDir, '_ANONYMIZATION_REPORT.json'), report);
  return { outDir, report };
}
