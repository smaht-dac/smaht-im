/**
 * Modals.jsx — all dialog/overlay components
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

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

// ── ActivateModal ─────────────────────────────────────────────────────────────

export function ActivateModal({ target, current, onConfirm, onCancel }) {
  const [snapName, setSnapName] = useState('');

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) { onConfirm(snapName.trim() || null); }
    if (input === 'y') { onConfirm(snapName.trim() || null); }
    if (input === 'n') { onCancel(); }
  });

  return (
    <Dialog title={`⚡ Activate  ${target.name}`} titleColor="green" width={68}>
      <Row label="Will replace:" value={current?.name ?? ACTIVE_FOLDER} labelColor="gray" />
      <Row label="Items currently:" value={String(current?.totalItems ?? '?')} labelColor="gray" />
      <Row label="New content:" value={target.name} labelColor="gray" />
      <Row label="Items to load:" value={String(target.totalItems)} labelColor="gray" />
      <Box height={1} />
      <Text color="yellow">
        Save current state as snapshot first? (leave blank to skip, Enter to confirm)
      </Text>
      <Box marginTop={1}>
        <Text color="gray">Name: </Text>
        <TextInput
          value={snapName}
          onChange={setSnapName}
          placeholder="e.g. my-work  or  2026-05-28"
          onSubmit={v => onConfirm(v.trim() || null)}
        />
      </Box>
      <ButtonBar
        buttons={[
          { key: 'Enter', label: 'Activate', color: 'green' },
          { key: 'Esc / n', label: 'Cancel', color: 'red' },
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

// ── MoveModal ─────────────────────────────────────────────────────────────────

export function MoveModal({ items, srcFolder, typeName, destinations, onConfirm, onCancel }) {
  const [dstIdx, setDstIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === 'n') { onCancel(); return; }
    if (key.upArrow)   setDstIdx(i => Math.max(0, i - 1));
    if (key.downArrow) setDstIdx(i => Math.min(destinations.length - 1, i + 1));
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
      <Text color="yellow">Destination folder  (↑/↓ to choose, Enter to move):</Text>

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
  ['  ↑ / ↓', 'Move within the focused panel'],
  ['  Tab', 'Move focus: Folders → Types → Items'],
  ['  Shift+Tab', 'Move focus in reverse'],
  ['', ''],
  ['Folder panel (left)', ''],
  ['  a', 'Activate selected folder (replaces temp-local-inserts)'],
  ['  n', 'New snapshot — copy active to a named folder'],
  ['  d', 'Diff selected folder vs temp-local-inserts'],
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
