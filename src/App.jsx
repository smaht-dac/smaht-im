/**
 * App.jsx — main application component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

import {
  loadAllFolders,
  activateFolder,
  createSnapshot,
  deleteFolder,
  moveItems,
  computeDiff,
  ACTIVE_FOLDER,
} from './core.js';

import { FolderPanel, TypePanel, ItemsPanel } from './Panels.jsx';
import {
  ActivateModal,
  SnapshotModal,
  DeleteModal,
  MoveModal,
  DiffModal,
  HelpModal,
  NotificationBar,
} from './Modals.jsx';

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer({ focus }) {
  const actions = [
    { key: 'a', desc: 'Activate', active: focus === 'folders' },
    { key: 'n', desc: 'Snap',     active: true },
    { key: 'm', desc: 'Move',     active: focus === 'items' },
    { key: 'd', desc: 'Diff',     active: focus === 'folders' },
    { key: 'Del', desc: 'Delete', active: focus === 'folders' },
    { key: 'r', desc: 'Refresh',  active: true },
    { key: '?', desc: 'Help',     active: true },
    { key: 'q', desc: 'Quit',     active: true },
    { key: 'Tab', desc: 'Panel',  active: true },
  ];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {actions.map((a, i) => (
        <Box key={a.key} marginRight={1}>
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

  const [folders,     setFolders]     = useState([]);
  const [folderIdx,   setFolderIdx]   = useState(0);
  const [typeIdx,     setTypeIdx]     = useState(0);
  const [itemIdx,     setItemIdx]     = useState(0);
  const [selectedUuids, setSelected]  = useState(new Set());
  const [modal,       setModal]       = useState(null);
  const [notification, setNote]       = useState(null); // { msg, isError }
  const [focus,       setFocus]       = useState('folders'); // tracked for footer

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
  };

  // ── global key handler ────────────────────────────────────────────────────

  useInput((input, key) => {
    if (modal) return; // modals handle their own input

    if (input === 'q') { exit(); return; }
    if (input === '?') { setModal('help'); return; }
    if (input === 'r') { refresh(); notify('Reloaded from disk'); return; }

    if ((key.tab && !key.shift) || input === 'l') {
      setFocus(f => f === 'folders' ? 'types' : f === 'types' ? 'items' : 'folders');
      return;
    }
    if ((key.shift && key.tab) || input === 'h') {
      setFocus(f => f === 'folders' ? 'items' : f === 'items' ? 'types' : 'folders');
      return;
    }

    // Folder panel actions
    if (input === 'a') {
      if (!currentFolder) { notify('No folder selected', true); return; }
      if (currentFolder.isActive) { notify('Already the active folder'); return; }
      setModal('activate');
      return;
    }
    if (input === 'n') { setModal('snapshot'); return; }
    if (input === 'd') {
      if (!currentFolder || currentFolder.isActive) {
        notify('Select a non-active folder to diff', true);
        return;
      }
      setModal('diff');
      return;
    }
    if (key.delete || key.backspace) {
      if (!currentFolder || currentFolder.isActive) {
        notify('Cannot delete the active folder', true);
        return;
      }
      setModal('delete');
      return;
    }

    // Items panel actions
    if (input === 'm') {
      if (!currentType) { notify('No type selected', true); return; }
      if (selectedUuids.size === 0) { notify('Select items first (Space)', true); return; }
      setModal('move');
      return;
    }
    if (input === ' ') {
      // toggle item at current cursor
      const item = currentItems[itemIdx];
      if (!item) return;
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(item.uuid)) next.delete(item.uuid);
        else next.add(item.uuid);
        return next;
      });
      return;
    }
    if (key.ctrl && input === 'a') {
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

  const handleActivate = (saveAs) => {
    setModal(null);
    try {
      const msg = activateFolder(currentFolder.name, saveAs);
      notify(msg);
      setFolderIdx(0); // active folder is always first after reload
      setTypeIdx(0);
      setSelected(new Set());
      refresh();
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

  // ── layout math ───────────────────────────────────────────────────────────

  // 1 header (from ink's render) + 1 footer bar + 1 notification bar
  const appHeight    = termHeight - 1; // stay below stdout.rows so Ink uses eraseLines not clearTerminal
  const footerHeight = 3;
  const notifHeight  = notification ? 1 : 0;
  const contentHeight = Math.max(8, appHeight - footerHeight - notifHeight);

  const typesPanelH  = Math.floor(contentHeight * 0.35);
  const itemsPanelH  = contentHeight - typesPanelH;

  // ── modal rendering ───────────────────────────────────────────────────────

  if (modal) {
    const diff = modal === 'diff' ? computeDiff(ACTIVE_FOLDER, currentFolder?.name) : null;
    const dstFolders = modal === 'move'
      ? folders.filter(f => f.name !== currentFolder?.name)
      : [];
    const selectedItemObjs = currentItems.filter(i => selectedUuids.has(i.uuid));

    return (
      <Box height={appHeight} flexDirection="column" justifyContent="center" alignItems="center">
        {modal === 'activate' && (
          <ActivateModal
            target={currentFolder}
            current={activeFolder}
            onConfirm={handleActivate}
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
            nameA={ACTIVE_FOLDER}
            nameB={currentFolder?.name}
            diff={diff}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'help' && (
          <HelpModal onClose={() => setModal(null)} />
        )}
      </Box>
    );
  }

  // ── main layout ───────────────────────────────────────────────────────────

  return (
    <Box height={appHeight} flexDirection="column">
      {/* Notification banner */}
      {notification && (
        <NotificationBar message={notification.msg} isError={notification.isError} />
      )}

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

        {/* Right: Type + Items */}
        <Box flexGrow={1} flexDirection="column">
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
          />
        </Box>
      </Box>

      {/* Footer */}
      <Footer focus={focus} />
    </Box>
  );
}
