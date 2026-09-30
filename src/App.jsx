/**
 * App.jsx — main application component
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

import {
  loadAllFolders,
  switchFolder,
  createFolder,
  syncWorkingCopyToFolder,
  createSnapshot,
  renameFolder,
  deleteFolder,
  moveItems,
  computeDiff,
  ACTIVE_FOLDER,
  folderLabel,
  loadBranchMeta,
  saveBranchMeta,
  getFolderEnvs,
  getFolderTracking,
  loadEnvAuth,
  checkRemoteAsync,
  syncFolderAsync,
  pullBatchIntoFolderAsync,
  syncItemAsync,
  anonymizeFolder,
  appendLog,
  readLogFile,
  listBackups,
  restoreBackup,
  backupFolder,
  copyToClipboard,
  editTypeFile,
} from './core.js';

import {
  loadBindings,
  saveBindings,
  matches,
  bindingLabel,
} from './keybindings.js';

import { FolderPanel, OverviewPanel, TypePanel, ItemsPanel, ItemDetailPanel, ErrorLogPanel } from './Panels.jsx';
import {
  NewFolderModal,
  RenameModal,
  SnapshotModal,
  DeleteModal,
  MoveModal,
  DiffModal,
  HelpModal,
  KeybindingsModal,
  SyncFolderModal,
  SyncItemModal,
  SetQueryModal,
  PullMoreModal,
  SearchModal,
  AnonymizeModal,
  ErrorLogModal,
  FullLogModal,
  ItemSyncResultModal,
  HistoryModal,
  PullLogModal,
  ItemDetailModal,
  NotificationBar,
} from './Modals.jsx';

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer({ focus, bindings, pulling, viewDetail, foldersCollapsed }) {
  const kb = bindings;
  const actions = [
    { key: bindingLabel(kb.newFolder),    desc: 'New',     active: true },
    { key: bindingLabel(kb.newEmptyFolder), desc: 'New Empty', active: true },
    { key: bindingLabel(kb.rename),       desc: 'Rename',  active: focus === 'folders' },
    { key: bindingLabel(kb.load),         desc: 'Load',    active: focus === 'folders' },
    { key: bindingLabel(kb.snapshot),     desc: 'Snap',    active: true },
    { key: bindingLabel(kb.moveItems),    desc: 'Move',    active: focus === 'items' },
    { key: bindingLabel(kb.copyClipboard), desc: 'Copy',   active: focus === 'folders' || focus === 'types' || focus === 'items' },
    { key: bindingLabel(kb.editFile),      desc: 'Edit',   active: focus === 'types' || focus === 'items' || focus === 'detail' },
    { key: bindingLabel(kb.toggleFolders), desc: foldersCollapsed ? 'Show Folders' : 'Hide Folders', active: true },
    { key: bindingLabel(kb.search),        desc: 'Find UUID', active: true },
    { key: bindingLabel(kb.rangeSelect),   desc: 'Range',  active: focus === 'folders' || focus === 'items' },
    { key: 'Enter',                       desc: 'View',    active: focus === 'items' },
    { key: bindingLabel(kb.diff),         desc: 'Diff',    active: focus === 'folders' },
    { key: bindingLabel(kb.deleteFolder), desc: 'Delete',  active: focus === 'folders' },
    { key: bindingLabel(kb.sync),         desc: 'Sync',    active: focus === 'folders' || focus === 'items' },
    { key: bindingLabel(kb.setQuery),     desc: 'Track',   active: focus === 'folders' },
    { key: bindingLabel(kb.pullMore),     desc: 'Pull More', active: focus === 'folders' },
    { key: bindingLabel(kb.exportAnon),   desc: 'Export',  active: focus === 'folders' },
    { key: bindingLabel(kb.viewHistory),  desc: 'History', active: focus === 'folders' },
    { key: bindingLabel(kb.expandLog),    desc: 'Log',     active: true },
    { key: bindingLabel(kb.viewFullLog),  desc: 'Full Log', active: true },
    { key: bindingLabel(kb.refresh),      desc: 'Refresh', active: true },
    { key: bindingLabel(kb.editKeys),     desc: 'Keys',    active: true },
    { key: bindingLabel(kb.help),         desc: 'Help',    active: true },
    { key: bindingLabel(kb.quit),         desc: 'Quit',    active: true },
    { key: 'Tab',                         desc: 'Panel',   active: true },
    // Only shown while a pull/sync is actually running — the footer already
    // wraps at common widths with the entries above; these matter for a small
    // fraction of real usage time, so they shouldn't permanently take up space.
    ...(pulling ? [
      { key: bindingLabel(kb.viewPull),   desc: 'View Pull',   active: true },
      { key: bindingLabel(kb.cancelPull), desc: 'Cancel Pull', active: true },
    ] : []),
    // Only shown while the item JSON preview is actually open — z has
    // nothing to zoom into otherwise.
    ...(viewDetail ? [{ key: 'z', desc: 'Full View', active: true }] : []),
  ];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexWrap="wrap">
      {actions.map((a, i) => (
        <Box key={a.key + a.desc} marginRight={1}>
          <Text color={a.active ? 'cyan' : 'gray'}>
            [{a.key}]
          </Text>
          <Text color={a.active ? 'white' : 'gray'}> {a.desc}</Text>
          {i < actions.length - 1 && <Text color="gray">  </Text>}
        </Box>
      ))}
    </Box>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const termHeight = stdout?.rows ?? 40;
  const termWidth  = stdout?.columns ?? 120;

  // ── state ─────────────────────────────────────────────────────────────────

  const [folders,       setFolders]     = useState([]);
  const [folderIdx,     setFolderIdx]   = useState(0);
  const [typeIdx,       setTypeIdx]     = useState(0);
  const [itemIdx,       setItemIdx]     = useState(0);
  const [selectedUuids, setSelected]   = useState(new Set());
  const [selectedFolderNames, setSelectedFolderNames] = useState(new Set());
  const [rangeAnchor, setRangeAnchor] = useState(null); // index marked by the first `v` press — 'items' or 'folders', whichever was focused
  const [modal,         setModal]       = useState(null);
  const [notification,  setNote]        = useState(null); // { msg, isError }
  const [focus,         setFocus]       = useState('folders');
  const [foldersCollapsed, setFoldersCollapsed] = useState(false); // shrunk to a name-only strip once focus leaves Folders
  const [viewDetail,    setViewDetail]  = useState(false); // item JSON preview, Items panel only — closes on focus change
  const [detailCursor,    setDetailCursor]    = useState(0);        // cursor into ItemDetailPanel's flattened row list
  const [detailCollapsed, setDetailCollapsed] = useState(new Set()); // node paths folded in the item JSON tree
  const [errorLog,      setErrorLog]    = useState([]);
  // Keyed by target folder name, not a single slot: more than one folder
  // can be pulling at once (see "Concurrent pulls" in CLAUDE.md). Each value
  // is { kind, target, cmd, kill, lastLine, done, success, killed }, same
  // shape as the old single pullState, just one per target now.
  const [pullStates,   setPullStates]  = useState(new Map());
  const pullLinesRef  = useRef(new Map()); // target -> full output buffer, read by PullLogModal
  const pullRenderRef = useRef(new Map()); // target -> last-throttled-render timestamp
  const [bindings,      setBindings]    = useState(() => loadBindings());
  const [remoteStatus,  setRemote]      = useState(new Map());
  const [syncDiff,       setSyncDiff]       = useState(null); // { folderName, rows } — folder-sync "what changed"
  const [itemSyncResult, setItemSyncResult] = useState(null); // { item, changes }     — item-sync "what changed"

  const didInitialCheck = useRef(false);

  // ── derived ───────────────────────────────────────────────────────────────

  const currentFolder = folders[folderIdx] ?? null;
  const currentType   = currentFolder?.types[typeIdx] ?? null;
  const currentItems  = currentType?.items ?? [];
  const activeFolder  = folders.find(f => f.isActive) ?? null;
  const currentFolderEnvs = currentFolder ? getFolderEnvs(currentFolder.name) : [];
  const currentFolderQuery = currentFolder ? getFolderTracking(currentFolder.name)?.query ?? null : null;
  const currentRemoteStatus = currentFolder ? remoteStatus.get(currentFolder.name) : null;
  const currentFolderBehind = currentRemoteStatus?.status === 'ok' ? currentRemoteStatus.behind : 0;

  // Actions that act "on the pull" (p/x/E/Footer's hints) are scoped to
  // whichever folder is currently highlighted, not "the one global pull",
  // navigate back to a folder that's pulling in the background to view/
  // cancel it. Other folders' pulls keep running regardless of where the
  // cursor is; FolderPanel's own per-row spinner is what tracks those.
  const isFolderPulling = (name) => { const p = pullStates.get(name); return !!p && !p.done; };
  const currentPullState = currentFolder ? pullStates.get(currentFolder.name) ?? null : null;
  const isCurrentFolderPulling = !!currentPullState && !currentPullState.done;
  const pullingLine = isCurrentFolderPulling ? currentPullState.lastLine : null; // compact spinner display, hidden once done
  const pullingFolderNames = new Set(
    [...pullStates.entries()].filter(([, p]) => p && !p.done).map(([name]) => name),
  );
  // handleCreateFolder's pull is the one case that writes through the
  // shared working copy (ACTIVE_FOLDER) rather than straight to its own
  // target folder (see its own comment below); while one is in flight,
  // nothing else may load a different folder into that same working copy,
  // or start a second one, regardless of which folder is highlighted.
  const anyCreatePullInFlight = [...pullStates.values()].some(p => p.kind === 'create' && !p.done);

  // ── load ──────────────────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    const loaded = loadAllFolders();
    setFolders(loaded);
    setTypeIdx(prev => {
      const f = loaded[folderIdx];
      return f ? Math.min(prev, (f.types.length || 1) - 1) : 0;
    });
  }, [folderIdx]);

  useEffect(() => { refresh(); }, []);

  // Item detail preview only makes sense while parked on Items or inside the
  // detail panel itself — close it the moment focus moves anywhere else,
  // regardless of which key caused that (Tab/Shift+Tab/h/l/folder or type
  // selection all funnel through the same `focus` state).
  useEffect(() => {
    if (focus !== 'items' && focus !== 'detail') setViewDetail(false);
  }, [focus]);

  // Collapse the Folders panel to a name-only strip the moment focus leaves
  // it, freeing width for Types/Items. It only re-expands on an explicit
  // action (Enter while focused there, the toggle key, or creating a new
  // folder), never just by tabbing back to it. See "Collapsible Folders
  // panel" in CLAUDE.md.
  useEffect(() => {
    if (focus !== 'folders') setFoldersCollapsed(true);
  }, [focus]);

  // A range anchor marked in one panel means nothing in another — e.g.
  // marking row 3 in Folders, then tabbing to Items, shouldn't let a later
  // `v` there silently pair with a Folders-panel index. Clear on any focus
  // change rather than trying to track which panel an anchor belongs to.
  useEffect(() => { setRangeAnchor(null); }, [focus]);

  // A different item's JSON has nothing in common with the last one's
  // collapse state or cursor position — start fresh whenever the highlighted
  // item changes, not just when the panel opens/closes.
  useEffect(() => {
    setDetailCursor(0);
    setDetailCollapsed(new Set());
  }, [itemIdx, currentType?.name]);

  // ── background remote checks ──────────────────────────────────────────────

  useEffect(() => {
    if (didInitialCheck.current || folders.length === 0) return;
    didInitialCheck.current = true;
    folders.forEach((f, i) => {
      const meta     = loadBranchMeta(f.name);
      const typeKeys = Object.keys(meta).filter(k => !k.startsWith('__'));
      const hasTracking = typeKeys.length > 0 || !!meta.__tracking__?.query;
      if (!hasTracking) {
        setRemote(prev => new Map(prev).set(f.name, { status: 'untracked' }));
        return;
      }
      setRemote(prev => new Map(prev).set(f.name, { status: 'checking' }));
      setTimeout(() => checkRemoteAsync(f.name, result => {
        setRemote(prev => new Map(prev).set(f.name, result));
      }), i * 200);
    });
  }, [folders]);

  const triggerRemoteCheck = (folderName) => {
    const meta     = loadBranchMeta(folderName);
    const typeKeys = Object.keys(meta).filter(k => !k.startsWith('__'));
    const hasTracking = typeKeys.length > 0 || !!meta.__tracking__?.query;
    if (!hasTracking) {
      setRemote(prev => new Map(prev).set(folderName, { status: 'untracked' }));
      return;
    }
    setRemote(prev => new Map(prev).set(folderName, { status: 'checking' }));
    checkRemoteAsync(folderName, result => {
      setRemote(prev => new Map(prev).set(folderName, result));
    });
  };

  // ── notification helpers ──────────────────────────────────────────────────

  const pushLog = (msg) => {
    setErrorLog(prev => [...prev.slice(-49), msg]);
    appendLog(msg);
  };

  const notify = (msg, isError = false) => {
    setNote({ msg, isError });
    setTimeout(() => setNote(null), 4000);
    if (isError) pushLog(msg);
  };

  // ── pull/sync tracking (shared by handleCreateFolder + handleSyncFolder) ─────
  // All three take `target` explicitly now (the folder name this particular
  // pull writes to) instead of assuming "the" pull, so concurrent pulls for
  // different targets each get their own entry rather than clobbering each
  // other's. See "Concurrent pulls" in CLAUDE.md.

  const startPull = (kind, target, cmd, kill) => {
    pullLinesRef.current.set(target, []);
    pullRenderRef.current.set(target, 0);
    setPullStates(prev => new Map(prev).set(target, { kind, target, cmd, kill, lastLine: cmd, done: false, success: false, killed: false }));
  };

  const onPullLine = (target, line) => {
    const buf = pullLinesRef.current.get(target) ?? [];
    buf.push(line);
    pullLinesRef.current.set(target, buf);
    const now = Date.now();
    const lastRender = pullRenderRef.current.get(target) ?? 0;
    if (now - lastRender >= 200) {
      pullRenderRef.current.set(target, now);
      setPullStates(prev => {
        const p = prev.get(target);
        if (!p || p.done) return prev;
        return new Map(prev).set(target, { ...p, lastLine: line });
      });
    }
  };

  const finishPull = (target, success, killed) => {
    setPullStates(prev => {
      const p = prev.get(target);
      if (!p) return prev;
      return new Map(prev).set(target, { ...p, done: true, success, killed });
    });
  };

  // ── global key handler ────────────────────────────────────────────────────

  useInput((input, key) => {
    if (modal) return; // modals handle their own input

    if (matches(bindings.quit,     input, key)) { exit(); return; }
    if (matches(bindings.help,     input, key)) { setModal('help'); return; }
    if (matches(bindings.refresh,  input, key)) { refresh(); notify('Reloaded from disk'); return; }
    if (matches(bindings.editKeys, input, key)) { setModal('editkeys'); return; }
    if (matches(bindings.expandLog, input, key)) { setModal('log'); return; }
    if (matches(bindings.viewFullLog, input, key)) { setModal('fulllog'); return; }
    if (matches(bindings.viewPull, input, key)) {
      if (!currentPullState) { notify('No pull/sync to show for this folder', true); return; }
      setModal('pull-log');
      return;
    }
    if (matches(bindings.cancelPull, input, key)) {
      if (!isCurrentFolderPulling) { notify('No pull/sync in progress for this folder', true); return; }
      currentPullState.kill();
      notify('Cancelling…');
      return;
    }
    if (matches(bindings.newFolder, input, key)) {
      setModal(focus === 'folders' && currentFolder ? `new-branch:${currentFolder.name}` : 'new-branch');
      return;
    }
    if (matches(bindings.newEmptyFolder, input, key)) {
      // No preset base — NewFolderModal defaults its "From" field to (none).
      setModal('new-branch');
      return;
    }
    if (matches(bindings.toggleFolders, input, key)) {
      setFoldersCollapsed(prev => {
        const next = !prev;
        if (!next) setFocus('folders'); // expanding also brings focus here to browse right away
        return next;
      });
      return;
    }
    if (matches(bindings.search, input, key)) {
      if (folders.length === 0) { notify('No folders to search', true); return; }
      setModal('search');
      return;
    }

    // Detail only joins the cycle while it's actually open — otherwise l/Tab
    // from Items wraps straight back to Folders same as always.
    const focusOrder = viewDetail ? ['folders', 'types', 'items', 'detail'] : ['folders', 'types', 'items'];
    if ((key.tab && !key.shift) || input === 'l') {
      setFocus(f => focusOrder[(focusOrder.indexOf(f) + 1) % focusOrder.length]);
      return;
    }
    if ((key.shift && key.tab) || input === 'h') {
      setFocus(f => focusOrder[(focusOrder.indexOf(f) - 1 + focusOrder.length) % focusOrder.length]);
      return;
    }

    // Expand the collapsed Folders panel, the other explicit action besides
    // the toggle key (see toggleFolders above). Deliberately does NOT fire
    // just from tabbing/h-ing focus back onto Folders; per the collapse
    // effect above, that alone leaves it collapsed until this or the toggle
    // key is pressed.
    if (key.return && focus === 'folders' && foldersCollapsed) {
      setFoldersCollapsed(false);
      return;
    }

    // Open/close the item JSON preview. Enter is structurally reserved
    // (captureKey() refuses to let it be rebound — see keybindings.js), so
    // like Tab/h/l this is a fixed key, not part of the bindings system.
    // Only opens/closes here — once focus is 'detail', Enter instead toggles
    // collapse of the highlighted node, handled by ItemDetailPanel itself.
    if (key.return && focus === 'items') {
      if (currentItems[itemIdx]) setViewDetail(v => !v);
      return;
    }

    // Zoom the item JSON preview to a full-screen modal — works whether
    // you're still on Items or have already Tab'd into the side panel, as
    // long as it's open. Like 'c' inside the detail panel, 'z' is hardcoded
    // rather than added to the bindings system (no default action claims it,
    // but a user-rebound one theoretically could — same caveat as 'c').
    if (input === 'z' && viewDetail && currentItems[itemIdx]) {
      setModal('item-detail');
      return;
    }

    // Folders panel actions
    if (matches(bindings.rename, input, key)) {
      if (!currentFolder) { notify('No folder selected', true); return; }
      setModal('rename');
      return;
    }
    if (matches(bindings.load, input, key)) {
      if (!currentFolder) { notify('No folder selected', true); return; }
      if (currentFolder.isActive) { notify('Already loaded'); return; }
      handleLoad();
      return;
    }
    if (matches(bindings.snapshot,     input, key)) { setModal('snapshot'); return; }
    if (matches(bindings.diff,         input, key)) {
      if (!currentFolder || currentFolder.isActive) {
        notify('Select a non-loaded folder to diff', true);
        return;
      }
      setModal('diff');
      return;
    }
    if (matches(bindings.deleteFolder, input, key)) {
      if (!currentFolder || currentFolder.isActive) {
        notify('Cannot delete the loaded folder', true);
        return;
      }
      setModal('delete');
      return;
    }
    if (matches(bindings.exportAnon, input, key)) {
      if (focus !== 'folders') { notify('Select a folder to export', true); return; }
      if (!currentFolder) { notify('No folder selected', true); return; }
      setModal('anonymize');
      return;
    }
    if (matches(bindings.viewHistory, input, key)) {
      if (!currentFolder) { notify('No folder selected', true); return; }
      setModal('history');
      return;
    }

    // Context-aware select key: loads a folder in the folders panel,
    // toggles item selection in the items panel.
    if (matches(bindings.selectItem, input, key)) {
      if (focus === 'folders') {
        if (!currentFolder) { notify('No folder selected', true); return; }
        if (currentFolder.isActive) { notify('Already loaded'); return; }
        handleLoad();
      } else if (focus === 'items') {
        const item = currentItems[itemIdx];
        if (!item) return;
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(item.uuid)) next.delete(item.uuid);
          else next.add(item.uuid);
          return next;
        });
      }
      return;
    }

    // Items panel actions
    if (matches(bindings.moveItems, input, key)) {
      if (!currentType) { notify('No type selected', true); return; }
      if (selectedUuids.size === 0) { notify('Select items first (Space)', true); return; }
      setModal('move');
      return;
    }
    if (matches(bindings.selectAll, input, key)) {
      setSelected(new Set(currentItems.map(i => i.uuid)));
      notify(`Selected all ${currentItems.length} items`);
      return;
    }
    if (matches(bindings.copyClipboard, input, key)) {
      try {
        if (focus === 'folders') {
          if (!currentFolder) { notify('No folder selected', true); return; }
          // Multiple selected folders merge type-by-type into one payload
          // (a second folder's donor.json items append to the first's)
          // rather than nesting per-folder — the shape stays exactly what
          // you'd get copying one folder, just with more in each array.
          const targets = selectedFolderNames.size > 0
            ? folders.filter(f => selectedFolderNames.has(f.name))
            : [currentFolder];
          const payload = {};
          let total = 0;
          for (const f of targets) {
            for (const t of f.types) {
              payload[t.name] = [...(payload[t.name] ?? []), ...t.items.map(i => i.data)];
            }
            total += f.totalItems;
          }
          copyToClipboard(JSON.stringify(payload, null, 2));
          const label = targets.length === 1 ? `'${folderLabel(targets[0].name)}'` : `${targets.length} folders`;
          notify(`Copied ${total} item(s) from ${label} to clipboard`);
        } else if (focus === 'items') {
          const selected = currentItems.filter(i => selectedUuids.has(i.uuid));
          // No selection falls back to just the highlighted item — same
          // "context you're looking at" default as moveItems's own logic
          // would need if it didn't require an explicit selection.
          const toCopy = selected.length > 0 ? selected : (currentItems[itemIdx] ? [currentItems[itemIdx]] : []);
          if (toCopy.length === 0) { notify('No item selected', true); return; }
          // A single item copies unwrapped — pasting one thing should give
          // you that thing, not a one-element array around it.
          const payload = toCopy.length === 1 ? toCopy[0].data : toCopy.map(i => i.data);
          copyToClipboard(JSON.stringify(payload, null, 2));
          notify(`Copied ${toCopy.length} item${toCopy.length !== 1 ? 's' : ''} to clipboard`);
        } else if (focus === 'types') {
          if (!currentType) { notify('No type selected', true); return; }
          // A plain array, not { typeName: [...] } — this already IS one
          // type, so the wrapper folder-copy needs to distinguish types
          // from each other would just be redundant noise here. Matches
          // the type's own file on disk (donor.json is itself just an
          // array), same reasoning as folder-copy matching the folder shape.
          const payload = currentType.items.map(i => i.data);
          copyToClipboard(JSON.stringify(payload, null, 2));
          notify(`Copied ${payload.length} item(s) from '${currentType.name}.json' to clipboard`);
        } else {
          notify('Select a folder, type, or item(s) to copy', true);
        }
      } catch (e) {
        notify(`Copy failed: ${e.message}`, true);
      }
      return;
    }
    if (matches(bindings.editFile, input, key)) {
      if (focus !== 'types' && focus !== 'items' && focus !== 'detail') {
        notify('Select a type or item to edit its file', true);
        return;
      }
      if (!currentFolder || !currentType) { notify('No type selected', true); return; }
      if (isCurrentFolderPulling) { notify('Cannot edit while this folder is being pulled', true); return; }
      handleEditTypeFile();
      return;
    }
    // Range select: first press marks the current row as the anchor (and
    // selects it, so there's visible feedback something happened); second
    // press — anywhere else in the list, in either direction — fills every
    // row between the anchor and here, then clears the anchor so the next
    // `v` starts a fresh range instead of extending this one indefinitely.
    if (matches(bindings.rangeSelect, input, key)) {
      if (focus === 'items') {
        if (!currentItems[itemIdx]) return;
        if (rangeAnchor === null) {
          setRangeAnchor(itemIdx);
          setSelected(prev => new Set(prev).add(currentItems[itemIdx].uuid));
          notify('Range start marked — move and press v again to select through here');
        } else {
          const [from, to] = [Math.min(rangeAnchor, itemIdx), Math.max(rangeAnchor, itemIdx)];
          const uuids = currentItems.slice(from, to + 1).map(i => i.uuid);
          setSelected(prev => new Set([...prev, ...uuids]));
          setRangeAnchor(null);
          notify(`Selected ${uuids.length} item${uuids.length !== 1 ? 's' : ''}`);
        }
      } else if (focus === 'folders') {
        if (!currentFolder) return;
        if (rangeAnchor === null) {
          setRangeAnchor(folderIdx);
          setSelectedFolderNames(prev => new Set(prev).add(currentFolder.name));
          notify('Range start marked — move and press v again to select through here');
        } else {
          const [from, to] = [Math.min(rangeAnchor, folderIdx), Math.max(rangeAnchor, folderIdx)];
          const names = folders.slice(from, to + 1).map(f => f.name);
          setSelectedFolderNames(prev => new Set([...prev, ...names]));
          setRangeAnchor(null);
          notify(`Selected ${names.length} folder${names.length !== 1 ? 's' : ''}`);
        }
      } else {
        notify('Select a folder or item to mark a range', true);
      }
      return;
    }
    if (key.escape) {
      setRangeAnchor(null);
      setSelectedFolderNames(new Set());
      if (viewDetail) { setViewDetail(false); setFocus('items'); return; }
      setSelected(new Set());
      return;
    }

    // Remote tracking actions (context-aware)
    if (matches(bindings.sync, input, key)) {
      if (focus === 'folders') {
        if (!currentFolder) { notify('No folder selected', true); return; }
        if (isFolderPulling(currentFolder.name)) { notify(`'${folderLabel(currentFolder.name)}' is already being pulled`, true); return; }
        setModal('sync-folder');
      } else if (focus === 'items') {
        const item = currentItems[itemIdx];
        if (!item) { notify('No item selected', true); return; }
        if (!currentType || !currentFolder) { notify('No type selected', true); return; }
        setModal('sync-item');
      }
      return;
    }
    if (matches(bindings.setQuery, input, key)) {
      if (!currentFolder) { notify('No folder selected', true); return; }
      setModal('set-query');
      return;
    }
    if (matches(bindings.pullMore, input, key)) {
      if (!currentFolder) { notify('No folder selected', true); return; }
      if (isFolderPulling(currentFolder.name)) { notify(`'${folderLabel(currentFolder.name)}' is already being pulled`, true); return; }
      setModal('pull-more');
      return;
    }
  });

  // ── modal callbacks ───────────────────────────────────────────────────────

  const handleLoad = () => {
    // Loading copies the target's on-disk content into the shared working
    // copy. Two things could make that unsafe right now, both opened up
    // by pulls being allowed to run concurrently at all (see
    // handleCreateFolder's own comment on the same working copy): reading
    // this folder while ITS OWN pull is still writing it, or clobbering the
    // working copy while handleCreateFolder's pull still depends on it
    // mirroring a different folder.
    if (anyCreatePullInFlight) {
      notify('Wait for the in-progress new-folder pull to finish first', true);
      return;
    }
    if (isFolderPulling(currentFolder.name)) {
      notify(`'${folderLabel(currentFolder.name)}' is still being pulled, wait for it to finish before loading it`, true);
      return;
    }
    try {
      const msg = switchFolder(currentFolder.name);
      notify(msg);
      setFolderIdx(0);
      setTypeIdx(0);
      setItemIdx(0);
      setSelected(new Set());
      refresh();
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleRename = (newSlug) => {
    setModal(null);
    try {
      renameFolder(currentFolder.name, newSlug);
      notify(`Renamed to '${newSlug}'`);
      refresh();
      setTypeIdx(0);
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleCreateFolder = ({ name, base, queries, env, doLoad }) => {
    const total = queries?.length ?? 0;
    // This is the one pull path that writes through the shared working copy
    // (ACTIVE_FOLDER below) rather than straight to its own target folder,
    // switchFolder(newName) further down makes that working copy mirror
    // newName for the duration of the pull, so a second one starting here
    // (whether another create, or someone loading a different folder
    // mid-pull, see handleLoad) would read or overwrite it out from under
    // this one. Checked before creating anything, not just before the pull,
    // so a refusal here never leaves an orphaned empty folder behind.
    if (total > 0 && anyCreatePullInFlight) {
      setModal(null);
      notify('Wait for the in-progress new-folder pull to finish first', true);
      return;
    }
    setModal(null);
    try {
      const newName = createFolder(name, base);
      // The new folder exists now regardless of what happens with any pull
      // below, expand the Folders panel (if collapsed) so it's actually
      // visible to navigate to, rather than leaving it hidden behind a
      // "created" notification with no way to see the result.
      setFoldersCollapsed(false);

      if (total > 0) {
        const prevLoaded = activeFolder?.name ?? null;

        try { switchFolder(newName); } catch (_) {}

        // ACTIVE_FOLDER resolves to the real working copy — pulling the
        // batch "into" it here is exactly the switchFolder-then-pull step
        // this path always needed; pullBatchIntoFolderAsync already knows
        // how to run several queries in order and stop at the first failure.
        const { kill } = pullBatchIntoFolderAsync(
          ACTIVE_FOLDER,
          env,
          queries,
          (i, t, q) => onPullLine(newName, `── Query ${i + 1}/${t}: ${q} ──`),
          (line) => onPullLine(newName, line),
          (result) => {
            finishPull(newName, result.success, result.killed);
            if (result.success) {
              let copied = true;
              try { syncWorkingCopyToFolder(newName); } catch (e) {
                copied = false;
                pushLog(`sync error: ${e.message}`);
              }
              if (copied) {
                // A single query doubles as the natural tracking query, same as
                // before — f/the staleness indicator work without a separate `t`
                // step. With several disjoint queries there's no one query that
                // re-running `f` could use, so tracking is left unset (same as
                // any other query-less folder) rather than storing a misleading one.
                if (total === 1) saveBranchMeta(newName, { __tracking__: { env, query: queries[0] } });
                triggerRemoteCheck(newName);
              }
              if (!doLoad && prevLoaded) {
                try { switchFolder(prevLoaded); } catch (_) {}
                notify(`'${name}' created`);
              } else {
                notify(`'${name}' created and loaded`);
                setFolderIdx(0);
              }
            } else {
              const errOut = (pullLinesRef.current.get(newName) ?? []).slice(-8).join('\n') || 'pull failed (no output)';
              pushLog(errOut);
              const cancelled = result.killed;
              let backupId = null;
              try { backupId = backupFolder(ACTIVE_FOLDER, `${cancelled ? 'cancelled' : 'failed'} pull for '${name}'`); } catch (_) {}
              // deleteFolder refuses to delete the currently-loaded folder, so
              // the restore has to succeed first — if it doesn't (prevLoaded
              // itself no longer exists, e.g. deleted from elsewhere), newName
              // stays loaded and can't be removed. Reflect that honestly rather
              // than claiming "folder removed" regardless of what happened.
              let removed = false;
              if (!prevLoaded) {
                try { deleteFolder(newName); removed = true; } catch (e) { pushLog(`cleanup error: ${e.message}`); }
              } else {
                try {
                  switchFolder(prevLoaded);
                  try { deleteFolder(newName); removed = true; } catch (e) { pushLog(`cleanup error: ${e.message}`); }
                } catch (e) {
                  pushLog(`restore error: ${e.message}`);
                }
              }
              const hint = backupId ? ` — partial data backed up (press ${bindingLabel(bindings.viewHistory)} on the active folder to recover)` : '';
              const progress = total > 1 ? ` after ${result.ranCount}/${total}` : '';
              const removalNote = removed ? ' — folder removed' : ` — '${name}' has partial data and is still loaded, remove it manually`;
              notify(`Pull ${cancelled ? 'cancelled' : 'failed'} for '${name}'${progress}${removalNote}${hint}`, true);
            }
            refresh();
          },
        );
        const cmd = total === 1 ? `pull: ${queries[0]}` : `pull-batch: ${total} queries`;
        pushLog(`$ ${cmd}`);
        startPull('create', newName, cmd, kill);
        notify(`Pulling inserts into '${name}'…`);
      } else {
        if (doLoad) switchFolder(newName);
        notify(`'${name}' created${doLoad ? ' and loaded' : ''}`);
        refresh();
        if (doLoad) setFolderIdx(0);
      }
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleSnapshot = (name) => {
    setModal(null);
    try {
      const snapName = createSnapshot(name);
      notify(`Snapshot created: '${snapName}'`);
      refresh();
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleDelete = () => {
    setModal(null);
    try {
      const msg = deleteFolder(currentFolder.name);
      notify(msg);
      setFolderIdx(prev => Math.max(0, prev - 1));
      setTypeIdx(0);
      refresh();
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleMove = (dstName) => {
    setModal(null);
    try {
      const result = moveItems(selectedUuids, currentFolder.name, dstName, currentType.name);
      notify(result.message);
      setSelected(new Set());
      setItemIdx(prev => Math.max(0, prev - result.moved));
      refresh();
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleAnonymize = ({ name, seed }) => {
    setModal(null);
    try {
      const { outDir, report } = anonymizeFolder(currentFolder.name, { destName: name, seed });
      const typeCount = Object.keys(report.types).length;
      notify(`Exported de-identified copy (${typeCount} type${typeCount !== 1 ? 's' : ''}) → ${outDir}`);
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleEditTypeFile = () => {
    const folderName = currentFolder.name;
    const typeName = currentType.name;
    try {
      const result = editTypeFile(folderName, typeName);
      if (result.edited) {
        notify(`Saved edits to '${typeName}.json' in '${folderLabel(folderName)}'`);
      } else {
        notify(
          `Edit not applied: ${result.error} (press ${bindingLabel(bindings.viewHistory)} to restore the pre-edit backup if needed)`,
          true,
        );
      }
    } catch (e) {
      notify(e.message, true);
    } finally {
      // A hand-edit can reorder or remove items, so whatever detailCursor/
      // itemIdx pointed at before may no longer mean the same thing, so
      // close the JSON detail view (side panel or full-screen modal) rather
      // than leave it showing a now-stale position. No-op if it wasn't open.
      if (viewDetail || focus === 'detail') {
        setViewDetail(false);
        setFocus('items');
      }
      refresh();
    }
  };

  const handleSyncFolder = () => {
    setModal(null);
    const folderName = currentFolder.name;
    notify(`Syncing '${folderLabel(folderName)}'...`);
    const { cmd, kill } = syncFolderAsync(folderName, (line) => onPullLine(folderName, line), (ok, msg, diff, info) => {
      finishPull(folderName, ok, !!info?.killed);
      refresh();
      if (!ok) { notify(msg, true); return; }
      triggerRemoteCheck(folderName);
      const changed = (diff ?? []).filter(r => r.added > 0 || r.removed > 0);
      if (changed.length > 0) {
        notify(`Synced '${folderLabel(folderName)}'`);
        setSyncDiff({ folderName, rows: changed });
        setModal('sync-result');
      } else {
        notify(`Synced '${folderLabel(folderName)}' — no changes`);
      }
    });
    if (cmd) { pushLog(`$ ${cmd}`); startPull('resync', folderName, cmd, kill); }
  };

  const handlePullMore = ({ env, queries }) => {
    setModal(null);
    const folderName = currentFolder.name;
    const total = queries.length;
    const plural = total !== 1 ? 'ies' : 'y';
    notify(`Pulling more into '${folderLabel(folderName)}' (${total} quer${plural})...`);
    const cmd = `pull-batch: ${total} quer${plural}`;
    const { kill } = pullBatchIntoFolderAsync(
      folderName,
      env,
      queries,
      (i, t, q) => onPullLine(folderName, `── Query ${i + 1}/${t}: ${q} ──`),
      (line) => onPullLine(folderName, line),
      (result) => {
        finishPull(folderName, result.success, result.killed);
        refresh();
        if (!result.success) {
          const verb = result.killed ? 'cancelled' : 'failed';
          notify(`Pull ${verb} after ${result.ranCount}/${total} — press p to see why`, true);
          return;
        }
        triggerRemoteCheck(folderName);
        const changed = (result.diff ?? []).filter(r => r.added > 0 || r.removed > 0);
        if (changed.length > 0) {
          notify(`Pulled more into '${folderLabel(folderName)}' (${total} quer${plural})`);
          setSyncDiff({ folderName, rows: changed });
          setModal('sync-result');
        } else {
          notify(`Pulled more into '${folderLabel(folderName)}' — no new items matched`);
        }
      },
    );
    pushLog(`$ ${cmd}`);
    startPull('pull-more', folderName, cmd, kill);
  };

  const handleSyncItem = () => {
    setModal(null);
    const item   = currentItems[itemIdx];
    const env        = getFolderTracking(currentFolder.name)?.env ?? 'data';
    const folderName = currentFolder.name;
    notify(`Refreshing item from ${env}...`);
    syncItemAsync(folderName, currentType.name, item.uuid, env, (ok, msg, changes) => {
      refresh();
      if (!ok) { notify(msg, true); return; }
      triggerRemoteCheck(folderName);
      if (changes && changes.length > 0) {
        notify(msg);
        setItemSyncResult({ item, changes });
        setModal('item-sync-result');
      } else {
        notify(`${msg} — no field changes`);
      }
    });
  };

  const handleRestoreBackup = (backup) => {
    setModal(null);
    try {
      const msg = restoreBackup(backup.target, backup.id);
      notify(msg);
      refresh();
    } catch (e) {
      notify(e.message, true);
    }
  };

  const handleSetQuery = ({ env, query }) => {
    setModal(null);
    saveBranchMeta(currentFolder.name, {
      __tracking__:    { env, query },
      __remote_cache__: null,
    });
    notify(`Tracking query set for '${folderLabel(currentFolder.name)}'`);
    triggerRemoteCheck(currentFolder.name);
  };

  // SearchModal already did the searching and let the user pick which
  // result they meant (its own list, navigated with ↑↓); this just jumps
  // to whichever one they confirmed, no re-searching here.
  const handleSearch = (picked) => {
    setModal(null);
    const { folderIdx, typeIdx, itemIdx, item, folderName } = picked;
    setFolderIdx(folderIdx);
    setTypeIdx(typeIdx);
    setItemIdx(itemIdx);
    setFocus('items');
    setViewDetail(true);
    notify(`Jumped to '${item.displayId || item.uuid}' in '${folderLabel(folderName)}'`);
  };

  const handleSaveKeybindings = (newBindings) => {
    saveBindings(newBindings);
    setBindings(newBindings);
    setModal(null);
    notify('Keybindings saved');
  };

  // ── layout math ───────────────────────────────────────────────────────────

  const appHeight    = termHeight - 1;
  // Generous fixed budget: the footer wraps onto multiple lines on narrower
  // terminals (flexWrap on the Footer box) rather than overflowing and
  // corrupting its own rendering. A few unused rows on wide terminals is a
  // much smaller cost than that corruption.
  const footerHeight = 5;
  const NOTIF_H      = 1;
  const contentHeight = Math.max(8, appHeight - footerHeight - NOTIF_H);

  const overviewH = 8;
  const logH      = 6;
  const rowH      = contentHeight - overviewH - logH;

  // ── modal rendering ───────────────────────────────────────────────────────

  if (modal) {
    const diff = modal === 'diff' ? computeDiff(ACTIVE_FOLDER, currentFolder?.name) : null;
    const fullLogLines = modal === 'fulllog' ? readLogFile() : null;
    const detailModalWidth  = Math.min(140, Math.max(60, termWidth - 8));
    const detailModalHeight = Math.max(10, termHeight - 6);
    // The active folder's own branch directory is never touched by a failed
    // create+pull cleanup (that partial data lived in the working copy,
    // ACTIVE_FOLDER, and is backed up under that key instead) — merge both
    // histories when browsing the active folder so that backup isn't orphaned.
    const historyBackups = modal === 'history' && currentFolder
      ? [
          ...listBackups(currentFolder.name).map(b => ({ ...b, target: currentFolder.name })),
          ...(currentFolder.isActive
            ? listBackups(ACTIVE_FOLDER).map(b => ({ ...b, target: ACTIVE_FOLDER }))
            : []),
        ].sort((a, b) => b.id.localeCompare(a.id))
      : null;
    const currentTrackingQuery = modal === 'pull-more' && currentFolder
      ? getFolderTracking(currentFolder.name)
      : null;
    const dstFolders = modal === 'move'
      ? folders.filter(f => f.name !== currentFolder?.name)
      : [];
    const selectedItemObjs = currentItems.filter(i => selectedUuids.has(i.uuid));

    return (
      <Box height={appHeight} flexDirection="column" justifyContent="center" alignItems="center">
        {modal?.startsWith('new-branch') && (
          <NewFolderModal
            folders={folders}
            initialBase={modal.includes(':') ? modal.split(':')[1] : null}
            onConfirm={handleCreateFolder}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'rename' && currentFolder && (
          <RenameModal
            folder={currentFolder}
            onConfirm={handleRename}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'snapshot' && (
          <SnapshotModal
            activeFolder={activeFolder}
            onConfirm={handleSnapshot}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'delete' && (
          <DeleteModal
            folder={currentFolder}
            onConfirm={handleDelete}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'move' && (
          <MoveModal
            items={selectedItemObjs}
            srcFolder={currentFolder?.name}
            typeName={currentType?.name}
            destinations={dstFolders}
            onConfirm={handleMove}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'diff' && diff && (
          <DiffModal
            nameA={activeFolder ? folderLabel(activeFolder.name) : 'current'}
            nameB={currentFolder ? folderLabel(currentFolder.name) : ''}
            diff={diff}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'help' && (
          <HelpModal bindings={bindings} onClose={() => setModal(null)} />
        )}
        {modal === 'editkeys' && (
          <KeybindingsModal
            bindings={bindings}
            onSave={handleSaveKeybindings}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'sync-folder' && currentFolder && (
          <SyncFolderModal
            folder={currentFolder}
            onConfirm={handleSyncFolder}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'sync-item' && currentFolder && currentType && currentItems[itemIdx] && (
          <SyncItemModal
            item={currentItems[itemIdx]}
            typeName={currentType.name}
            folderName={currentFolder.name}
            env={getFolderTracking(currentFolder.name)?.env ?? 'data'}
            onConfirm={handleSyncItem}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'set-query' && currentFolder && (
          <SetQueryModal
            folder={currentFolder}
            onConfirm={handleSetQuery}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'search' && (
          <SearchModal
            folders={folders}
            onConfirm={handleSearch}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'pull-more' && currentFolder && (
          <PullMoreModal
            folder={currentFolder}
            currentQuery={currentTrackingQuery}
            onConfirm={handlePullMore}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'anonymize' && currentFolder && (
          <AnonymizeModal
            folder={currentFolder}
            onConfirm={handleAnonymize}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'log' && (
          <ErrorLogModal
            errors={errorLog}
            pulling={pullingLine}
            expandKey={bindingLabel(bindings.expandLog)}
            viewFullLogKey={bindingLabel(bindings.viewFullLog)}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'fulllog' && (
          <FullLogModal
            lines={fullLogLines}
            viewKey={bindingLabel(bindings.viewFullLog)}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'sync-result' && syncDiff && (
          <DiffModal
            nameA={`${folderLabel(syncDiff.folderName)} (before)`}
            nameB={`${folderLabel(syncDiff.folderName)} (after)`}
            diff={syncDiff.rows}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'item-sync-result' && itemSyncResult && (
          <ItemSyncResultModal
            item={itemSyncResult.item}
            changes={itemSyncResult.changes}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'history' && currentFolder && (
          <HistoryModal
            folder={currentFolder}
            backups={historyBackups ?? []}
            onRestore={handleRestoreBackup}
            onCancel={() => setModal(null)}
          />
        )}
        {modal === 'pull-log' && currentPullState && (
          <PullLogModal
            pull={currentPullState}
            lines={pullLinesRef.current.get(currentFolder.name) ?? []}
            cancelKey={bindingLabel(bindings.cancelPull)}
            viewKey={bindingLabel(bindings.viewPull)}
            onCancel={() => currentPullState.kill()}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'item-detail' && currentItems[itemIdx] && (
          <ItemDetailModal
            item={currentItems[itemIdx]}
            width={detailModalWidth}
            height={detailModalHeight}
            selectedIdx={detailCursor}
            onSelect={setDetailCursor}
            collapsed={detailCollapsed}
            onCollapsedChange={setDetailCollapsed}
            onClose={() => setModal(null)}
            onEdit={() => { setModal(null); handleEditTypeFile(); }}
            editKey={bindingLabel(bindings.editFile)}
          />
        )}
      </Box>
    );
  }

  // ── main layout ───────────────────────────────────────────────────────────

  const itemHints = {
    select:    bindingLabel(bindings.selectItem),
    selectAll: bindingLabel(bindings.selectAll),
    move:      bindingLabel(bindings.moveItems),
  };

  return (
    <Box height={appHeight} flexDirection="column">
      {/* Notification banner — fixed 1-row slot */}
      <Box height={NOTIF_H}>
        {notification && (
          <NotificationBar message={notification.msg} isError={notification.isError} />
        )}
      </Box>

      {/* Main content row */}
      <Box flexGrow={1} flexDirection="row">
        {/* Left: Folder panel */}
        <FolderPanel
          folders={folders}
          selectedIdx={folderIdx}
          onSelect={(idx) => {
            setFolderIdx(idx);
            setTypeIdx(0);
            setItemIdx(0);
            setSelected(new Set());
            setFocus('folders');
          }}
          height={contentHeight}
          isFocused={focus === 'folders'}
          remoteStatus={remoteStatus}
          pullingFolderNames={pullingFolderNames}
          selectedNames={selectedFolderNames}
          collapsed={foldersCollapsed}
          toggleKey={bindingLabel(bindings.toggleFolders)}
        />

        {/* Right: Overview + (Types | Items) + Log */}
        <Box flexGrow={1} flexDirection="column">
          <OverviewPanel
            folder={currentFolder}
            envs={currentFolderEnvs}
            query={currentFolderQuery}
            behind={currentFolderBehind}
            syncKey={bindingLabel(bindings.sync)}
            height={overviewH}
          />
          <Box flexDirection="row" height={rowH}>
            <TypePanel
              folder={currentFolder}
              selectedIdx={typeIdx}
              onSelect={(idx) => {
                setTypeIdx(idx);
                setItemIdx(0);
                setSelected(new Set());
                setFocus('types');
              }}
              height={rowH}
              isFocused={focus === 'types'}
            />
            <ItemsPanel
              itype={currentType}
              selectedIdx={itemIdx}
              onSelect={(idx) => {
                setItemIdx(idx);
                setFocus('items');
              }}
              selectedUuids={selectedUuids}
              height={rowH}
              isFocused={focus === 'items'}
              hints={itemHints}
            />
            {viewDetail && currentItems[itemIdx] && (
              <ItemDetailPanel
                item={currentItems[itemIdx]}
                height={rowH}
                isFocused={focus === 'detail'}
                selectedIdx={detailCursor}
                onSelect={setDetailCursor}
                collapsed={detailCollapsed}
                onCollapsedChange={setDetailCollapsed}
                editKey={bindingLabel(bindings.editFile)}
              />
            )}
          </Box>
          <ErrorLogPanel
            errors={errorLog}
            pulling={pullingLine}
            height={logH}
            expandHint={bindingLabel(bindings.expandLog)}
          />
        </Box>
      </Box>

      {/* Footer */}
      <Footer focus={focus} bindings={bindings} pulling={isCurrentFolderPulling} viewDetail={viewDetail} foldersCollapsed={foldersCollapsed} />
    </Box>
  );
}
