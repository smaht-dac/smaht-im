/**
 * App.jsx — main application component
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

import {
  loadAllFolders,
  switchFolder,
  createFolder,
  pullFolderAsync,
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
} from './core.js';

import {
  loadBindings,
  saveBindings,
  matches,
  bindingLabel,
} from './keybindings.js';

import { FolderPanel, OverviewPanel, TypePanel, ItemsPanel, ErrorLogPanel } from './Panels.jsx';
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
  AnonymizeModal,
  ErrorLogModal,
  FullLogModal,
  ItemSyncResultModal,
  HistoryModal,
  PullLogModal,
  NotificationBar,
} from './Modals.jsx';

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer({ focus, bindings, pulling }) {
  const kb = bindings;
  const actions = [
    { key: bindingLabel(kb.newFolder),    desc: 'New',     active: true },
    { key: bindingLabel(kb.rename),       desc: 'Rename',  active: focus === 'folders' },
    { key: bindingLabel(kb.load),         desc: 'Load',    active: focus === 'folders' },
    { key: bindingLabel(kb.snapshot),     desc: 'Snap',    active: true },
    { key: bindingLabel(kb.moveItems),    desc: 'Move',    active: focus === 'items' },
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
  const [modal,         setModal]       = useState(null);
  const [notification,  setNote]        = useState(null); // { msg, isError }
  const [focus,         setFocus]       = useState('folders');
  const [errorLog,      setErrorLog]    = useState([]);
  const [pullState,     setPullState]  = useState(null); // { kind, target, cmd, kill, lastLine, done, success, killed }
  const pullLinesRef = useRef([]);  // full output buffer for the in-flight/last pull — read by PullLogModal
  const pullRenderRef = useRef(0);  // throttle timer for lastLine UI updates
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
  const isPulling     = !!pullState && !pullState.done;
  const pullingLine   = isPulling ? pullState.lastLine : null; // compact spinner display — hidden once done

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

  const startPull = (kind, target, cmd, kill) => {
    pullLinesRef.current = [];
    pullRenderRef.current = 0;
    setPullState({ kind, target, cmd, kill, lastLine: cmd, done: false, success: false, killed: false });
  };

  const onPullLine = (line) => {
    pullLinesRef.current.push(line);
    const now = Date.now();
    if (now - pullRenderRef.current >= 200) {
      pullRenderRef.current = now;
      setPullState(prev => (prev && !prev.done) ? { ...prev, lastLine: line } : prev);
    }
  };

  const finishPull = (success, killed) => {
    setPullState(prev => prev ? { ...prev, done: true, success, killed } : prev);
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
      if (!pullState) { notify('No pull/sync to show', true); return; }
      setModal('pull-log');
      return;
    }
    if (matches(bindings.cancelPull, input, key)) {
      if (!pullState || pullState.done) { notify('No pull/sync in progress', true); return; }
      pullState.kill();
      notify('Cancelling…');
      return;
    }
    if (matches(bindings.newFolder, input, key)) {
      setModal(focus === 'folders' && currentFolder ? `new-branch:${currentFolder.name}` : 'new-branch');
      return;
    }

    if ((key.tab && !key.shift) || input === 'l') {
      setFocus(f => f === 'folders' ? 'types' : f === 'types' ? 'items' : 'folders');
      return;
    }
    if ((key.shift && key.tab) || input === 'h') {
      setFocus(f => f === 'folders' ? 'items' : f === 'items' ? 'types' : 'folders');
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
    if (key.escape) {
      setSelected(new Set());
      return;
    }

    // Remote tracking actions (context-aware)
    if (matches(bindings.sync, input, key)) {
      if (focus === 'folders') {
        if (!currentFolder) { notify('No folder selected', true); return; }
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
      setModal('pull-more');
      return;
    }
  });

  // ── modal callbacks ───────────────────────────────────────────────────────

  const handleLoad = () => {
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

  const handleCreateFolder = ({ name, base, query, env, doLoad }) => {
    setModal(null);
    try {
      const newName = createFolder(name, base);

      if (query) {
        const prevLoaded = activeFolder?.name ?? null;

        try { switchFolder(newName); } catch (_) {}

        const { cmd, kill } = pullFolderAsync(
          env,
          query,
          onPullLine,
          (success, info) => {
            finishPull(success, !!info?.killed);
            if (success) {
              let copied = true;
              try { syncWorkingCopyToFolder(newName); } catch (e) {
                copied = false;
                pushLog(`sync error: ${e.message}`);
              }
              if (copied) {
                // The query that pulled this folder's initial contents is the natural
                // tracking query — set it so f/the staleness indicator work immediately,
                // without a separate `t` step.
                saveBranchMeta(newName, { __tracking__: { env, query } });
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
              const errOut = pullLinesRef.current.slice(-8).join('\n') || 'pull failed (no output)';
              pushLog(errOut);
              const cancelled = !!info?.killed;
              let backupId = null;
              try { backupId = backupFolder(ACTIVE_FOLDER, `${cancelled ? 'cancelled' : 'failed'} pull for '${name}'`); } catch (_) {}
              if (prevLoaded) try { switchFolder(prevLoaded); } catch (_) {}
              try { deleteFolder(newName); } catch (_) {}
              const hint = backupId ? ` — partial data backed up (press ${bindingLabel(bindings.viewHistory)} on the active folder to recover)` : '';
              notify(`Pull ${cancelled ? 'cancelled' : 'failed'} for '${name}' — folder removed${hint}`, true);
            }
            refresh();
          },
        );
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

  const handleSyncFolder = () => {
    setModal(null);
    const folderName = currentFolder.name;
    notify(`Syncing '${folderLabel(folderName)}'...`);
    const { cmd, kill } = syncFolderAsync(folderName, onPullLine, (ok, msg, diff, info) => {
      finishPull(ok, !!info?.killed);
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
      (i, t, q) => onPullLine(`── Query ${i + 1}/${t}: ${q} ──`),
      onPullLine,
      (result) => {
        finishPull(result.success, result.killed);
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
    const meta   = loadBranchMeta(currentFolder.name);
    const typeKeys = Object.keys(meta).filter(k => !k.startsWith('__'));
    const env        = (typeKeys.length > 0 ? meta[typeKeys[0]]?.env : meta.__tracking__?.env) ?? 'data';
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

  const overviewH = 4;
  const logH      = 6;
  const rowH      = contentHeight - overviewH - logH;

  // ── modal rendering ───────────────────────────────────────────────────────

  if (modal) {
    const diff = modal === 'diff' ? computeDiff(ACTIVE_FOLDER, currentFolder?.name) : null;
    const fullLogLines = modal === 'fulllog' ? readLogFile() : null;
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
      ? (() => {
          const meta = loadBranchMeta(currentFolder.name);
          const typeKeys = Object.keys(meta).filter(k => !k.startsWith('__'));
          return typeKeys.length > 0 ? meta[typeKeys[0]] : meta.__tracking__;
        })()
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
            env={(() => {
              const meta = loadBranchMeta(currentFolder.name);
              const tk = Object.keys(meta).filter(k => !k.startsWith('__'));
              return (tk.length > 0 ? meta[tk[0]]?.env : meta.__tracking__?.env) ?? 'data';
            })()}
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
        {modal === 'pull-log' && pullState && (
          <PullLogModal
            pull={pullState}
            lines={pullLinesRef.current}
            cancelKey={bindingLabel(bindings.cancelPull)}
            viewKey={bindingLabel(bindings.viewPull)}
            onCancel={() => pullState.kill()}
            onClose={() => setModal(null)}
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
        />

        {/* Right: Overview + (Types | Items) + Log */}
        <Box flexGrow={1} flexDirection="column">
          <OverviewPanel
            folder={currentFolder}
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
      <Footer focus={focus} bindings={bindings} pulling={isPulling} />
    </Box>
  );
}
