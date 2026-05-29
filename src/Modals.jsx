/**
 * Modals.jsx — all dialog/overlay components
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { folderLabel } from './core.js';

// ── Shared layout ─────────────────────────────────────────────────────────────

function Dialog({ title, titleColor = 'cyan', width = 64, children }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={titleColor}
      width={width}
      paddingX={2}
      paddingY={1}
    >
      <Text bold color={titleColor}>
        {title}
      </Text>
      <Box height={1} />
      {children}
    </Box>
  );
}

function Row({ label, value, labelColor = 'gray' }) {
  return (
    <Box>
      <Text color={labelColor}>{label.padEnd(20)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

function ButtonBar({ buttons }) {
  // buttons: [{ label, color, key }]
  return (
    <Box marginTop={1} gap={2}>
      {buttons.map(b => (
        <Text key={b.key} color={b.color ?? 'white'}>
          [{b.key}] {b.label}
        </Text>
      ))}
    </Box>
  );
}

// ── LoadModal ─────────────────────────────────────────────────────────────

export function LoadModal({ target, current, onConfirm, onCancel }) {
  useInput((input, key) => {
    if (key.escape || input === 'n') { onCancel(); return; }
    if (key.return || input === 'y' || input === 'a') onConfirm();
  });

  const targetLabel  = folderLabel(target.name);
  const currentLabel = current ? folderLabel(current.name) : '—';

  return (
    <Dialog title={`↪  Load '${targetLabel}'`} titleColor="green" width={60}>
      <Row label="Current folder:" value={currentLabel}                        labelColor="gray" />
      <Row label="Items:"          value={String(current?.totalItems ?? '?')}  labelColor="gray" />
      <Box height={1} />
      <Row label="Load folder:"    value={targetLabel}                         labelColor="yellow" />
      <Row label="Items:"          value={String(target.totalItems)}           labelColor="yellow" />
      <Box height={1} />
      <Text color="gray">
        This folder's inserts will be loaded into the working copy.
      </Text>
      <ButtonBar
        buttons={[
          { key: 'Enter / y', label: 'Load',   color: 'green' },
          { key: 'Esc / n',   label: 'Cancel', color: 'red' },
        ]}
      />
    </Dialog>
  );
}

// ── SnapshotModal ─────────────────────────────────────────────────────────────

export function SnapshotModal({ activeFolder, onConfirm, onCancel }) {
  const [name, setName] = useState('');

  useInput((input, key) => {
    if (key.escape) onCancel();
    if (input === 'n') onCancel();
  });

  return (
    <Dialog title="📸 New Snapshot" titleColor="cyan" width={60}>
      <Text color="gray">
        Creates a copy of temp-local-inserts as:
      </Text>
      <Text color="white">  temp-local-inserts-{`{name}`}</Text>
      <Text color="gray">The active folder is NOT changed.</Text>
      <Box height={1} />
      <Text color="yellow">Snapshot name (Enter to create):</Text>
      <Box marginTop={1}>
        <Text color="gray">Name: </Text>
        <TextInput
          value={name}
          onChange={setName}
          placeholder="e.g. staging  or  donor-test"
          onSubmit={v => { if (v.trim()) onConfirm(v.trim()); }}
        />
      </Box>
      <ButtonBar
        buttons={[
          { key: 'Enter', label: 'Create', color: 'green' },
          { key: 'Esc', label: 'Cancel', color: 'red' },
        ]}
      />
    </Dialog>
  );
}

// ── DeleteModal ───────────────────────────────────────────────────────────────

export function DeleteModal({ folder, onConfirm, onCancel }) {
  useInput((input, key) => {
    if (key.escape || input === 'n') { onCancel(); return; }
    if (input === 'y') onConfirm();
  });

  return (
    <Dialog title={`🗑  Delete  ${folder.name}`} titleColor="red" width={62}>
      <Text color="white">
        This will permanently delete the folder and all{' '}
        <Text bold color="red">{folder.totalItems}</Text> items in it.
      </Text>
      <Text color="yellow">This cannot be undone.</Text>
      <ButtonBar
        buttons={[
          { key: 'y', label: 'Delete permanently', color: 'red' },
          { key: 'n / Esc', label: 'Cancel', color: 'green' },
        ]}
      />
    </Dialog>
  );
}

// ── NewFolderModal ────────────────────────────────────────────────────────────

const ENVS = ['data', 'staging', 'devtest', 'wolf'];
const N_FIELDS = 5; // name=0  base=1  query=2  env=3  checkout=4

export function NewFolderModal({ folders, onConfirm, onCancel, initialBase = null }) {
  const baseOpts = [
    { label: '(none)', value: null },
    ...folders.map(b => ({ label: folderLabel(b.name), value: b.name })),
  ];
  const initBaseIdx = initialBase
    ? Math.max(0, baseOpts.findIndex(o => o.value === initialBase))
    : 0;

  const [fieldIdx,   setField]    = useState(0);
  const [readyField, setReady]    = useState(0); // lags fieldIdx by one tick — prevents mount race
  const [name,       setName]     = useState('');
  const [baseIdx,    setBaseIdx]  = useState(initBaseIdx);
  const [query,      setQuery]    = useState('');
  const [envIdx,     setEnvIdx]   = useState(0);
  const [doLoad, setDoLoad] = useState(true);

  useEffect(() => { setReady(fieldIdx); }, [fieldIdx]);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }

    // Tab / Shift-Tab always navigate fields
    if (key.tab && !key.shift) { setField(f => (f + 1) % N_FIELDS); return; }
    if (key.shift && key.tab)  { setField(f => (f - 1 + N_FIELDS) % N_FIELDS); return; }

    // Up/down navigate fields when NOT in a text-input field
    if (fieldIdx !== 0 && fieldIdx !== 2) {
      if (key.downArrow) { setField(f => (f + 1) % N_FIELDS); return; }
      if (key.upArrow)   { setField(f => (f - 1 + N_FIELDS) % N_FIELDS); return; }
    }

    // Left / right change selection in base (1) and env (3)
    if (fieldIdx === 1) {
      if (key.leftArrow)  { setBaseIdx(i => Math.max(0, i - 1)); return; }
      if (key.rightArrow) { setBaseIdx(i => Math.min(baseOpts.length - 1, i + 1)); return; }
    }
    if (fieldIdx === 3) {
      if (key.leftArrow)  { setEnvIdx(i => Math.max(0, i - 1)); return; }
      if (key.rightArrow) { setEnvIdx(i => Math.min(ENVS.length - 1, i + 1)); return; }
    }

    // Space toggles checkout
    if (fieldIdx === 4 && input === ' ') { setDoLoad(c => !c); return; }

    // Enter submits (name required)
    if (key.return && name.trim()) {
      onConfirm({
        name:       name.trim(),
        base:       baseOpts[baseIdx].value,
        query:      query.trim() || null,
        env:        ENVS[envIdx],
        doLoad,
      });
    }
  });

  const fc = fi => fieldIdx === fi ? 'cyan' : 'gray'; // field label color

  return (
    <Dialog title="⊕  New Folder" titleColor="cyan" width={74}>
      {/* ── Name ── */}
      <Box>
        <Text color={fc(0)}>{'Name    '}</Text>
        {readyField === 0
          ? <TextInput value={name} onChange={setName} placeholder="my-folder" onSubmit={() => {}} />
          : <Text color={name ? 'white' : 'gray'}>{name || 'my-folder'}</Text>}
      </Box>

      {/* ── From (base branch) ── */}
      <Box marginTop={1}>
        <Text color={fc(1)}>{'From    '}</Text>
        {fieldIdx === 1 ? (
          <Box>
            <Text color="gray">◀  </Text>
            <Text color="cyan" bold>{baseOpts[baseIdx].label}</Text>
            <Text color="gray">  ▶</Text>
          </Box>
        ) : (
          <Text color={baseIdx === 0 ? 'gray' : 'white'}>{baseOpts[baseIdx].label}</Text>
        )}
      </Box>

      {/* ── Query ── */}
      <Box marginTop={1}>
        <Text color={fc(2)}>{'Query   '}</Text>
        {readyField === 2
          ? <TextInput value={query} onChange={setQuery} placeholder="?type=Donor&status=released" onSubmit={() => {}} />
          : <Text color={query ? 'white' : 'gray'}>{query || '?type=Donor&status=released'}</Text>}
      </Box>

      {/* ── Env slider ── */}
      <Box marginTop={1}>
        <Text color={fc(3)}>{'Env     '}</Text>
        <Box gap={2}>
          {ENVS.map((e, i) => {
            const sel = i === envIdx;
            const foc = fieldIdx === 3;
            return (
              <Text key={e} bold={sel} color={sel && foc ? 'cyan' : sel ? 'white' : 'gray'}>
                {foc && sel ? `[ ${e} ]` : e}
              </Text>
            );
          })}
        </Box>
      </Box>

      {/* ── Checkout toggle ── */}
      <Box marginTop={1}>
        <Text color={fc(4)}>{doLoad ? '[✓]' : '[ ]'}</Text>
        <Text color={fieldIdx === 4 ? 'white' : 'gray'}> Load after creating</Text>
      </Box>

      <ButtonBar buttons={[
        { key: 'Enter', label: 'Create',     color: 'green' },
        { key: 'Tab',   label: 'Next field', color: 'cyan'  },
        { key: 'Esc',   label: 'Cancel',     color: 'red'   },
      ]} />
    </Dialog>
  );
}

// ── MoveModal ─────────────────────────────────────────────────────────────────

export function MoveModal({ items, srcFolder, typeName, destinations, onConfirm, onCancel }) {
  const [dstIdx, setDstIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === 'n') { onCancel(); return; }
    if (key.upArrow   || input === 'k') setDstIdx(i => Math.max(0, i - 1));
    if (key.downArrow || input === 'j') setDstIdx(i => Math.min(destinations.length - 1, i + 1));
    if (key.return || input === 'm') {
      if (destinations[dstIdx]) onConfirm(destinations[dstIdx].name);
    }
  });

  const visible = destinations.slice(0, 8);

  return (
    <Dialog
      title={`↗  Move ${items.length} item${items.length !== 1 ? 's' : ''} from ${srcFolder}/${typeName}.json`}
      titleColor="yellow"
      width={70}
    >
      <Text color="gray">Items to move:</Text>
      {items.slice(0, 5).map(item => (
        <Box key={item.uuid} paddingLeft={2}>
          <Text color="white">
            {item.uuid.slice(0, 16)}…  {item.displayId}
          </Text>
        </Box>
      ))}
      {items.length > 5 && (
        <Box paddingLeft={2}>
          <Text color="gray">…and {items.length - 5} more</Text>
        </Box>
      )}

      <Box height={1} />
      <Text color="yellow">Destination folder  (↑↓ / jk to choose, Enter to move):</Text>

      {visible.map((f, i) => (
        <Box key={f.name} paddingLeft={2}>
          <Text
            bold={i === dstIdx}
            color={i === dstIdx ? 'green' : 'gray'}
          >
            {i === dstIdx ? '▶ ' : '  '}
            {f.name}  [{f.totalItems}]
          </Text>
        </Box>
      ))}
      {destinations.length === 0 && (
        <Text color="red">  No other folders available</Text>
      )}

      <ButtonBar
        buttons={[
          { key: 'Enter / m', label: 'Move', color: 'green' },
          { key: 'Esc / n', label: 'Cancel', color: 'red' },
        ]}
      />
    </Dialog>
  );
}

// ── DiffModal ─────────────────────────────────────────────────────────────────

export function DiffModal({ nameA, nameB, diff, onClose }) {
  useInput((input, key) => {
    if (key.escape || input === 'q' || key.return) onClose();
  });

  const hasChanges = diff.some(r => r.added > 0 || r.removed > 0);
  const visible = diff.slice(0, 18);

  return (
    <Dialog
      title={`⇄  Diff   ${nameA}   vs   ${nameB}`}
      titleColor="cyan"
      width={78}
    >
      {/* Column headers */}
      <Box paddingLeft={1}>
        <Text color="gray" bold>
          {'Type'.padEnd(34)}
          {'In A'.padStart(6)}
          {'In B'.padStart(6)}
          {' +Added'.padStart(8)}
          {'-Removed'.padStart(9)}
          {'  =Same'.padStart(7)}
        </Text>
      </Box>

      {visible.map(row => {
        const hasChange = row.added > 0 || row.removed > 0;
        const color = !hasChange ? 'gray' : row.removed > 0 && row.added === 0 ? 'red' : 'yellow';
        return (
          <Box key={row.type} paddingLeft={1}>
            <Text color={color}>
              {row.type.padEnd(34)}
              {String(row.countA).padStart(6)}
              {String(row.countB).padStart(6)}
              {(row.added > 0 ? `+${row.added}` : '—').padStart(8)}
              {(row.removed > 0 ? `-${row.removed}` : '—').padStart(9)}
              {String(row.same).padStart(7)}
            </Text>
          </Box>
        );
      })}

      {diff.length > 18 && (
        <Text color="gray">  … and {diff.length - 18} more types</Text>
      )}

      {!hasChanges && (
        <Box marginTop={1}>
          <Text color="green">✓ Folders are identical</Text>
        </Box>
      )}

      <ButtonBar buttons={[{ key: 'Esc / Enter', label: 'Close', color: 'cyan' }]} />
    </Dialog>
  );
}

// ── HelpModal ─────────────────────────────────────────────────────────────────

const HELP_ROWS = [
  ['Navigation', ''],
  ['  ↑↓ / jk', 'Move within the focused panel'],
  ['  Tab / l', 'Move focus: Folders → Types → Items'],
  ['  Shift+Tab / h', 'Move focus in reverse'],
  ['', ''],
  ['Folders panel (left)', ''],
  ['  c', 'Create new inserts folder'],
  ['  a', 'Load selected folder into working copy'],
  ['  n', 'Snapshot — copy current working state to new folder'],
  ['  d', 'Diff selected folder vs loaded folder'],
  ['  Delete', 'Delete selected folder (with confirmation)'],
  ['', ''],
  ['Items panel (bottom-right)', ''],
  ['  Space', 'Toggle item selection (multi-select)'],
  ['  m', 'Move selected items to another folder'],
  ['  ctrl+a', 'Select all items in the current type'],
  ['  Esc', 'Clear all selections'],
  ['', ''],
  ['Global', ''],
  ['  r', 'Refresh all folders from disk'],
  ['  ?', 'Toggle this help'],
  ['  q', 'Quit'],
];

export function HelpModal({ onClose }) {
  useInput((input, key) => {
    if (key.escape || input === 'q' || input === '?') onClose();
  });

  return (
    <Dialog title="? Keyboard Shortcuts" titleColor="magenta" width={62}>
      {HELP_ROWS.map(([key, desc], i) => (
        <Box key={i}>
          {key === '' ? (
            <Box height={1} />
          ) : desc === '' ? (
            <Text bold color="magenta">{key}</Text>
          ) : (
            <Box>
              <Text color="cyan">{key.padEnd(14)}</Text>
              <Text color="white">{desc}</Text>
            </Box>
          )}
        </Box>
      ))}
      <ButtonBar buttons={[{ key: 'Esc / ? / q', label: 'Close', color: 'magenta' }]} />
    </Dialog>
  );
}

// ── NotificationBar ───────────────────────────────────────────────────────────

export function NotificationBar({ message, isError }) {
  if (!message) return null;
  return (
    <Box paddingX={2} paddingY={0}>
      <Text color={isError ? 'red' : 'green'}>{isError ? '✗ ' : '✓ '}{message}</Text>
    </Box>
  );
}
