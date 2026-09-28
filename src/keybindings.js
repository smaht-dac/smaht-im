/**
 * keybindings.js — user-configurable key bindings for imc
 *
 * Persisted at ~/.smaht-im/keybindings.json. Missing or invalid entries
 * fall back to DEFAULT_BINDINGS automatically.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const KEYBINDINGS_FILE = path.join(os.homedir(), '.smaht-im', 'keybindings.json');

export const DEFAULT_BINDINGS = {
  quit:         { key: 'q',      ctrl: false, label: 'Quit' },
  help:         { key: '?',      ctrl: false, label: 'Help' },
  refresh:      { key: 'R',      ctrl: false, label: 'Refresh from disk' },
  editKeys:     { key: 'K',      ctrl: false, label: 'Edit keybindings' },
  newFolder:    { key: 'n',      ctrl: false, label: 'New folder' },
  newEmptyFolder: { key: 'N',    ctrl: false, label: 'New folder (empty base)' },
  rename:       { key: 'r',      ctrl: false, label: 'Rename folder' },
  load:         { key: 'a',      ctrl: false, label: 'Load folder' },
  snapshot:     { key: 's',      ctrl: false, label: 'Snapshot working copy' },
  diff:         { key: 'd',      ctrl: false, label: 'Diff folder' },
  deleteFolder: { key: 'D',      ctrl: false, label: 'Delete folder' },
  moveItems:    { key: 'm',      ctrl: false, label: 'Move items' },
  copyClipboard: { key: 'y',     ctrl: false, label: 'Copy to clipboard (context-aware)' },
  rangeSelect:  { key: 'v',      ctrl: false, label: 'Select range (context-aware)' },
  selectItem:   { key: ' ',      ctrl: false, label: 'Toggle / load (context-aware)' },
  selectAll:    { key: 'a',      ctrl: true,  label: 'Select all items' },
  sync:         { key: 'f',      ctrl: false, label: 'Sync from portal (context-aware)' },
  setQuery:     { key: 't',      ctrl: false, label: 'Set tracking query' },
  exportAnon:   { key: 'e',      ctrl: false, label: 'Export de-identified copy' },
  expandLog:    { key: 'L',      ctrl: false, label: 'Expand error log' },
  viewFullLog:  { key: 'F',      ctrl: false, label: 'View full log file' },
  viewHistory:  { key: 'H',      ctrl: false, label: 'View folder backup history' },
  viewPull:     { key: 'p',      ctrl: false, label: 'View pull/sync output' },
  cancelPull:   { key: 'x',      ctrl: false, label: 'Cancel in-progress pull/sync' },
  pullMore:     { key: 'A',      ctrl: false, label: 'Pull more into folder with a new query' },
  editFile:     { key: 'E',      ctrl: false, label: 'Edit type file in $EDITOR (context-aware)' },
  toggleFolders: { key: 'o',     ctrl: false, label: 'Toggle Folders panel open/closed' },
};

/** Load bindings from disk, merged over defaults. Always returns a complete map. */
export function loadBindings() {
  try {
    const saved = JSON.parse(fs.readFileSync(KEYBINDINGS_FILE, 'utf8'));
    return Object.fromEntries(
      Object.entries(DEFAULT_BINDINGS).map(([action, def]) => [
        action,
        action in saved ? { ...def, ...saved[action] } : { ...def },
      ]),
    );
  } catch {
    return Object.fromEntries(
      Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, { ...v }]),
    );
  }
}

/** Write the full bindings map to disk. */
export function saveBindings(bindings) {
  const dir = path.dirname(KEYBINDINGS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KEYBINDINGS_FILE, JSON.stringify(bindings, null, 2));
}

/** True if the ink (input, key) event fires this binding. */
export function matches(binding, input, inkKey) {
  if (!binding) return false;
  const wantsCtrl = binding.ctrl ?? false;
  const hasCtrl   = inkKey.ctrl ?? false;
  if (wantsCtrl !== hasCtrl) return false;
  if (binding.key === 'Delete') return !!(inkKey.delete || inkKey.backspace);
  return input === binding.key;
}

/**
 * Human-readable display label: "^A", "Delete", "Space", "q". Ctrl bindings
 * use "^" + the uppercased key rather than spelling out "ctrl+", the
 * conventional terminal notation for a control character (the same "^C"/
 * "^D" shells themselves already print), also much more compact, which
 * matters anywhere this label has to fit in a narrow space (e.g. the
 * collapsed Folders panel).
 */
export function bindingLabel(binding) {
  if (!binding) return '—';
  if (binding.ctrl) return `^${(binding.key ?? '').toUpperCase()}`;
  return binding.key === ' ' ? 'Space' : binding.key;
}

/**
 * Find which other action already uses the given key combo.
 * Returns [actionName, binding] or null if no collision.
 */
export function findCollision(bindings, excludeAction, newKey, ctrl) {
  for (const [action, b] of Object.entries(bindings)) {
    if (action === excludeAction) continue;
    if (b.key === newKey && (b.ctrl ?? false) === (ctrl ?? false)) return [action, b];
  }
  return null;
}

/**
 * Parse an ink event into a storable { key, ctrl } descriptor.
 * Returns null if the key is structurally reserved (Esc, Enter, Tab, arrows)
 * and therefore cannot be bound to an action.
 */
export function captureKey(input, inkKey) {
  if (inkKey.escape || inkKey.return || inkKey.tab) return null;
  if (inkKey.upArrow || inkKey.downArrow || inkKey.leftArrow || inkKey.rightArrow) return null;
  if (inkKey.delete || inkKey.backspace) return { key: 'Delete', ctrl: false };
  if (input && input.length === 1) return { key: input, ctrl: inkKey.ctrl ?? false };
  return null;
}
