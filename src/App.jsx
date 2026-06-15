/**
 * App.jsx — main application component
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  LoadModal,
  RenameModal,
  SnapshotModal,
  DeleteModal,
  MoveModal,
  DiffModal,
  HelpModal,
  KeybindingsModal,
  NotificationBar,
} from './Modals.jsx';

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer({ focus, bindings }) {
  const kb = bindings;
  const actions = [
    { key: bindingLabel(kb.newFolder),    desc: 'New',     active: true },
    { key: bindingLabel(kb.rename),       desc: 'Rename',  active: focus === 'folders' },
    { key: bindingLabel(kb.load),         desc: 'Load',    active: focus === 'folders' },
    { key: bindingLabel(kb.snapshot),     desc: 'Snap',    active: true },
    { key: bindingLabel(kb.moveItems),    desc: 'Move',    active: focus === 'items' },
    { key: bindingLabel(kb.diff),         desc: 'Diff',    active: focus === 'folders' },
    { key: bindingLabel(kb.deleteFolder), desc: 'Delete',  active: focus === 'folders' },
    { key: bindingLabel(kb.refresh),      desc: 'Refresh', active: true },
    { key: bindingLabel(kb.help),         desc: 'Help',    active: true },
    { key: bindingLabel(kb.quit),         desc: 'Quit',    active: true },
    { key: 'Tab',                         desc: 'Panel',   active: true },
  ];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
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
  const [pulling,       setPulling]     = useState(null);
  const [bindings,      setBindings]    = useState(() => loadBindings());

  // ── derived ───────────────────────────────────────────────────────────────

  const currentFolder = folders[folderIdx] ?? null;
  const currentType   = currentFolder?.types[typeIdx] ?? null;
  const currentItems  = currentType?.items ?? [];
  const activeFolder  = folders.find(f => f.isActive) ?? null;

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

  // ── notification helpers ──────────────────────────────────────────────────

  const notify = (msg, isError = false) => {
    setNote({ msg, isError });
    setTimeout(() => setNote(null), 4000);
    if (isError) setErrorLog(prev => [...prev.slice(-49), msg]);
  };

  // ── global key handler ────────────────────────────────────────────────────

  useInput((input, key) => {
    if (modal) return; // modals handle their own input

    if (matches(bindings.quit,     input, key)) { exit(); return; }
    if (matches(bindings.help,     input, key)) { setModal('help'); return; }
    if (matches(bindings.refresh,  input, key)) { refresh(); notify('Reloaded from disk'); return; }
    if (matches(bindings.editKeys, input, key)) { setModal('editkeys'); return; }
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
      setModal('checkout');
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

    // Context-aware select key: loads a folder in the folders panel,
    // toggles item selection in the items panel.
    if (matches(bindings.selectItem, input, key)) {
      if (focus === 'folders') {
        if (!currentFolder) { notify('No folder selected', true); return; }
        if (currentFolder.isActive) { notify('Already loaded'); return; }
        setModal('checkout');
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
  });

  // ── modal callbacks ───────────────────────────────────────────────────────

  const handleLoad = () => {
    setModal(null);
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

        const lines = [];
        let lastPullRender = 0;
        const cmd = pullFolderAsync(
          env,
          query,
          (line) => {
            lines.push(line);
            const now = Date.now();
            if (now - lastPullRender >= 200) {
              setPulling(line);
              lastPullRender = now;
            }
          },
          (success) => {
            setPulling(null);
            if (success) {
              try { syncWorkingCopyToFolder(newName); } catch (e) {
                setErrorLog(prev => [...prev.slice(-49), `sync error: ${e.message}`]);
              }
              if (!doLoad && prevLoaded) {
                try { switchFolder(prevLoaded); } catch (_) {}
                notify(`'${name}' created`);
              } else {
                notify(`'${name}' created and loaded`);
                setFolderIdx(0);
              }
            } else {
              const errOut = lines.slice(-8).join('\n') || 'pull failed (no output)';
              setErrorLog(prev => [...prev.slice(-49), errOut]);
              if (prevLoaded) try { switchFolder(prevLoaded); } catch (_) {}
              try { deleteFolder(newName); } catch (_) {}
              notify(`Pull failed for '${name}' — folder removed`, true);
            }
            refresh();
          },
        );
        setErrorLog(prev => [...prev.slice(-49), `$ ${cmd}`]);
        setPulling(cmd);
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

  const handleSaveKeybindings = (newBindings) => {
    saveBindings(newBindings);
    setBindings(newBindings);
    setModal(null);
    notify('Keybindings saved');
  };

  // ── layout math ───────────────────────────────────────────────────────────

  const appHeight    = termHeight - 1;
  const footerHeight = 3;
  const NOTIF_H      = 1;
  const contentHeight = Math.max(8, appHeight - footerHeight - NOTIF_H);

  const overviewH   = 4;
  const logH        = 6;
  const remainingH  = contentHeight - overviewH - logH;
  const typesPanelH = Math.floor(remainingH * 0.35);
  const itemsPanelH = remainingH - typesPanelH;

  // ── modal rendering ───────────────────────────────────────────────────────

  if (modal) {
    const diff = modal === 'diff' ? computeDiff(ACTIVE_FOLDER, currentFolder?.name) : null;
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
        {modal === 'checkout' && (
          <LoadModal
            target={currentFolder}
            current={activeFolder}
            onConfirm={handleLoad}
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
        />

        {/* Right: Overview + Type + Items */}
        <Box flexGrow={1} flexDirection="column">
          <OverviewPanel
            folder={currentFolder}
            height={overviewH}
          />
          <TypePanel
            folder={currentFolder}
            selectedIdx={typeIdx}
            onSelect={(idx) => {
              setTypeIdx(idx);
              setItemIdx(0);
              setSelected(new Set());
              setFocus('types');
            }}
            height={typesPanelH}
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
            height={itemsPanelH}
            isFocused={focus === 'items'}
            hints={itemHints}
          />
          <ErrorLogPanel errors={errorLog} pulling={pulling} height={logH} />
        </Box>
      </Box>

      {/* Footer */}
      <Footer focus={focus} bindings={bindings} />
    </Box>
  );
}
