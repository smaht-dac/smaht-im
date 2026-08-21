/**
 * Modals.jsx — all dialog/overlay components
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { folderLabel, LOG_FILE } from './core.js';
import { trunc, Spinner } from './Panels.jsx';
import {
  DEFAULT_BINDINGS,
  bindingLabel,
  findCollision,
  captureKey,
} from './keybindings.js';

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

// ── SnapshotModal ─────────────────────────────────────────────────────────────

export function SnapshotModal({ activeFolder, onConfirm, onCancel }) {
  const [name, setName] = useState('');

  useInput((input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Dialog title="📸 New Snapshot" titleColor="cyan" width={60}>
      <Text color="gray">
        Creates a named copy of the working copy as a new branch.
      </Text>
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

// ── RenameModal ───────────────────────────────────────────────────────────────

export function RenameModal({ folder, onConfirm, onCancel }) {
  const current = folderLabel(folder.name);
  const [name, setName] = useState(current);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
  });

  return (
    <Dialog title={`✎  Rename '${current}'`} titleColor="yellow" width={62}>
      <Box>
        <Text color="gray">New name  </Text>
        <TextInput
          value={name}
          onChange={setName}
          placeholder={current}
          onSubmit={v => { if (v.trim()) onConfirm(v.trim()); }}
        />
      </Box>
      <ButtonBar buttons={[
        { key: 'Enter', label: 'Rename', color: 'yellow' },
        { key: 'Esc',   label: 'Cancel', color: 'red' },
      ]} />
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
  const [queued,     setQueued]   = useState([]); // queries added chip-input style, run in order
  const [envIdx,     setEnvIdx]   = useState(0);
  const [doLoad, setDoLoad] = useState(true);

  useEffect(() => { setReady(fieldIdx); }, [fieldIdx]);

  const submitCreate = (queries) => {
    if (!name.trim()) return;
    onConfirm({
      name:    name.trim(),
      base:    baseOpts[baseIdx].value,
      queries,
      env:     ENVS[envIdx],
      doLoad,
    });
  };

  // Chip-input on the Query field: Enter on non-empty text queues it and
  // clears the field; Enter on an already-empty field creates the folder
  // with whatever's queued (0 or more) — so "type, Enter, type, Enter, ...,
  // Enter" both builds the query list and creates, and a plain Enter with
  // nothing typed still creates a query-less folder as before.
  const submitQuery = (value) => {
    const trimmed = value.trim();
    if (trimmed) {
      setQueued(prev => [...prev, trimmed]);
      setQuery('');
      return;
    }
    submitCreate(queued);
  };

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

    if (fieldIdx === 2) {
      // TextInput's own onSubmit already handles Enter once it's mounted
      // (readyField === 2) — only fall back to handling it here for the
      // one-tick window before it mounts, otherwise both fire.
      if (key.return && readyField !== 2) { submitQuery(query); return; }
      if (key.backspace && !query) { setQueued(prev => prev.slice(0, -1)); return; } // remove last queued
      return;
    }

    // Enter submits (name required)
    if (key.return) submitCreate(queued);
  });

  const fc = fi => fieldIdx === fi ? 'cyan' : 'gray'; // field label color
  const enterLabel = fieldIdx === 2 && query.trim() ? 'Add query' : 'Create';

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

      {/* ── Queries queued so far ── */}
      {queued.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">Queued to run in order:</Text>
          {queued.map((q, i) => (
            <Box key={i} paddingLeft={2}>
              <Text color="white">{i + 1}. {trunc(q, 62)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Query ── */}
      <Box marginTop={1}>
        <Text color={fc(2)}>{'Query   '}</Text>
        {readyField === 2
          ? <TextInput value={query} onChange={setQuery} placeholder="?type=Donor&status=released" onSubmit={submitQuery} />
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
        { key: 'Enter',     label: enterLabel,    color: 'green' },
        { key: 'Backspace', label: 'Remove last query', color: 'yellow' },
        { key: 'Tab',       label: 'Next field',  color: 'cyan'  },
        { key: 'Esc',       label: 'Cancel',      color: 'red'   },
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
      title={`↗  Move ${items.length} item${items.length !== 1 ? 's' : ''} from ${folderLabel(srcFolder)}/${typeName}.json`}
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
            {folderLabel(f.name)}  [{f.totalItems}]
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

// ── HistoryModal ──────────────────────────────────────────────────────────────
// Backups are taken automatically before every folder/item sync (see
// backupFolder in core.js) — this is the recovery interface for them.

export function HistoryModal({ folder, backups, onRestore, onCancel }) {
  const [idx, setIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === 'q') { onCancel(); return; }
    if (key.upArrow   || input === 'k') { setIdx(i => Math.max(0, i - 1)); return; }
    if (key.downArrow || input === 'j') { setIdx(i => Math.min(backups.length - 1, i + 1)); return; }
    if ((key.return || input === 'r') && backups[idx]) { onRestore(backups[idx]); return; }
  });

  const visible = backups.slice(0, 12);
  const label   = folderLabel(folder.name);

  return (
    <Dialog title={`⟲  Backup history — ${label}`} titleColor="cyan" width={80}>
      <Text color="gray">Taken automatically before every folder sync (f) and item sync (f).</Text>
      <Box height={1} />

      {backups.length === 0 && (
        <Text color="gray">No backups yet for this folder — sync it once to start building history.</Text>
      )}

      {visible.map((b, i) => {
        const isSel = i === idx;
        const fromWorkingCopy = b.target !== folder.name;
        return (
          <Box key={`${b.target}:${b.id}`} paddingLeft={1}>
            <Text bold={isSel} color={isSel ? 'green' : 'gray'}>
              {isSel ? '▶ ' : '  '}
              {new Date(b.ts).toLocaleString().padEnd(24)}
            </Text>
            <Text color={isSel ? 'white' : 'gray'}>
              {trunc(b.reason, 44)}{fromWorkingCopy ? ' [working copy]' : ''}
            </Text>
          </Box>
        );
      })}
      {backups.length > 12 && (
        <Box paddingLeft={1}><Text color="gray">…and {backups.length - 12} more</Text></Box>
      )}

      <Box height={1} />
      <Text color="yellow">Restoring backs up the current state first, then replaces the folder's files.</Text>

      <ButtonBar buttons={[
        { key: '↑↓ / jk',   label: 'Choose',  color: 'cyan' },
        { key: 'Enter / r', label: 'Restore', color: 'green' },
        { key: 'Esc / q',   label: 'Cancel',  color: 'red' },
      ]} />
    </Dialog>
  );
}

// ── HelpModal ─────────────────────────────────────────────────────────────────

function buildHelpRows(bindings) {
  const b = (action) => '  ' + bindingLabel(bindings?.[action] ?? DEFAULT_BINDINGS[action]);
  const selKey  = bindingLabel(bindings?.selectItem  ?? DEFAULT_BINDINGS.selectItem);
  const loadKey = bindingLabel(bindings?.load        ?? DEFAULT_BINDINGS.load);
  return [
    ['Navigation', ''],
    ['  ↑↓ / jk',      'Move within the focused panel'],
    ['  Tab / l',       'Move focus: Folders → Types → Items'],
    ['  Shift+Tab / h', 'Move focus in reverse'],
    ['', ''],
    ['Folders panel (left)', ''],
    [b('newFolder'),                      'Create new inserts folder'],
    [b('newEmptyFolder'),                 'Create new inserts folder, defaulting to an empty base'],
    [b('rename'),                         'Rename selected folder'],
    [`  ${loadKey} / ${selKey}`,          'Load selected folder into working copy'],
    [b('snapshot'),                       'Snapshot — copy current working state to new folder'],
    [b('diff'),                           'Diff selected folder vs loaded folder'],
    [b('deleteFolder'),                   'Delete selected folder (with confirmation)'],
    [b('exportAnon'),                     'Export a de-identified copy to ~/smaht-im-exports/'],
    [b('viewHistory'),                    'View backup history for selected folder — restore any prior state'],
    ['', ''],
    ['Items panel (bottom-right)', ''],
    [`  ${selKey}`,                       'Toggle item selection (multi-select)'],
    [b('moveItems'),                      'Move selected items to another folder'],
    [b('selectAll'),                      'Select all items in the current type'],
    [b('sync'),                           'Refresh highlighted item from portal'],
    ['  Esc',                             'Clear all selections'],
    ['', ''],
    ['Remote tracking', ''],
    [b('sync') + ' (folders)',            'Sync folder — re-pull from portal (backs up current state first)'],
    [b('setQuery'),                       'Set tracking query for selected folder'],
    [b('pullMore'),                       'Pull more into folder via one or more queries run in order (tracking unchanged, no backup)'],
    ['', ''],
    ['Sync results & recovery', ''],
    ['  (automatic)',                     'A folder/item sync with real changes opens a "what changed" report'],
    [b('viewHistory'),                    'Browse and restore backups taken before each sync'],
    [b('viewPull'),                       'View full scrollable output of the current/last pull or sync'],
    [b('cancelPull'),                     'Cancel an in-progress pull or sync'],
    ['', ''],
    ['Global', ''],
    [b('expandLog'),                      'Open scrollable error log (this session)'],
    [b('viewFullLog'),                    'View the full persisted log file (~/.smaht-im/imc.log)'],
    [b('refresh'),                        'Refresh all folders from disk'],
    [b('help'),                           'Toggle this help'],
    [b('editKeys'),                       'Edit keybindings'],
    [b('quit'),                           'Quit'],
  ];
}

export function HelpModal({ bindings, onClose }) {
  const helpKey = bindings?.help?.key ?? '?';
  useInput((input, key) => {
    if (key.escape || input === 'q' || input === helpKey) onClose();
  });

  const rows = buildHelpRows(bindings);

  return (
    <Dialog title="? Keyboard Shortcuts" titleColor="magenta" width={62}>
      {rows.map(([key, desc], i) => (
        <Box key={i}>
          {key === '' ? (
            <Box height={1} />
          ) : desc === '' ? (
            <Text bold color="magenta">{key}</Text>
          ) : (
            <Box>
              <Text color="cyan">{key.padEnd(16)}</Text>
              <Text color="white">{desc}</Text>
            </Box>
          )}
        </Box>
      ))}
      <ButtonBar buttons={[{ key: 'Esc / q', label: 'Close', color: 'magenta' }]} />
    </Dialog>
  );
}

// ── LogViewer (shared by ErrorLogModal + FullLogModal) ────────────────────────

/** Layout numbers shared by both log modals — kept in one place so they don't drift apart. */
function useLogLayout(extraChromeRows = 0) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 40;
  const termWidth  = stdout?.columns ?? 120;

  const width     = Math.min(140, Math.max(70, termWidth - 6));
  const textWidth = width - 8; // border(2) + paddingX(2*2) + margin

  // border(2) + title(1) + spacer(1) + count line(1) + ButtonBar(2)
  const chromeRows = 7 + extraChromeRows;
  const maxRows    = Math.max(5, termHeight - 4 - chromeRows);

  return { width, textWidth, maxRows };
}

function LogViewer({ width, textWidth, maxRows, title, titleColor, lines, renderLine, header, footerNote, closeKey, onClose }) {
  const [offset, setOffset] = useState(() => Math.max(0, lines.length - maxRows));
  const maxOffset = Math.max(0, lines.length - maxRows);
  const clamped   = Math.max(0, Math.min(offset, maxOffset));

  useInput((input, key) => {
    if (key.escape || input === 'q' || input === closeKey) { onClose(); return; }
    if (key.upArrow   || input === 'k') { setOffset(o => Math.max(0, o - 1)); return; }
    if (key.downArrow || input === 'j') { setOffset(o => Math.min(maxOffset, o + 1)); return; }
    if (input === 'g') { setOffset(0); return; }
    if (input === 'G') { setOffset(maxOffset); return; }
  });

  const visible = lines.slice(clamped, clamped + maxRows);

  return (
    <Dialog title={title} titleColor={titleColor} width={width}>
      {header}

      {lines.length === 0 && !header && (
        <Text color="gray">No entries</Text>
      )}

      {visible.map((line, i) => (
        <Box key={clamped + i}>{renderLine(line, textWidth)}</Box>
      ))}

      <Box marginTop={1}>
        <Text color="gray">
          {lines.length > 0
            ? `Line ${clamped + 1}-${Math.min(clamped + maxRows, lines.length)} of ${lines.length}   `
            : ''}
          {footerNote}
        </Text>
      </Box>

      <ButtonBar buttons={[
        { key: '↑↓ / jk', label: 'Scroll',      color: 'cyan' },
        { key: 'g / G',   label: 'Top / bottom', color: 'cyan' },
        { key: `Esc / q / ${closeKey}`, label: 'Close', color: 'gray' },
      ]} />
    </Dialog>
  );
}

function renderErrorLine(text, textWidth) {
  const isCmd = text.startsWith('$ ');
  return isCmd
    ? <Text color="cyan">{trunc(text, textWidth)}</Text>
    : <><Text color="red">✗ </Text><Text color="white">{trunc(text, textWidth - 2)}</Text></>;
}

// ── ErrorLogModal ─────────────────────────────────────────────────────────────
// Session-scoped: the in-memory errorLog (capped at 50 entries, lost on quit).

export function ErrorLogModal({ errors, pulling, expandKey, viewFullLogKey, onClose }) {
  const { width, textWidth, maxRows } = useLogLayout(pulling ? 1 : 0);
  const errCount   = errors.filter(e => !e.startsWith('$ ')).length;
  const hasRealErr = errCount > 0;

  const header = pulling ? (
    <Box>
      <Spinner />
      <Text color="yellow">{trunc(pulling, textWidth - 2)}</Text>
    </Box>
  ) : null;

  return (
    <LogViewer
      width={width} textWidth={textWidth} maxRows={maxRows}
      title={hasRealErr ? `✗  Error Log (${errCount})` : ' Log'}
      titleColor={hasRealErr ? 'red' : 'gray'}
      lines={errors}
      renderLine={renderErrorLine}
      header={header}
      footerNote={`[${viewFullLogKey}] full persisted log — ${LOG_FILE}`}
      closeKey={expandKey}
      onClose={onClose}
    />
  );
}

// ── FullLogModal ──────────────────────────────────────────────────────────────
// Reads the persisted file directly — up to 500 lines, survives across restarts.

const STAMP_RE = /^(\[[^\]]+\]\s)(.*)$/;

function renderFullLogLine(line, textWidth) {
  const m = line.match(STAMP_RE);
  const stamp = m ? m[1] : '';
  const rest  = m ? m[2] : line;
  const restWidth = Math.max(8, textWidth - stamp.length);
  const isCmd = rest.startsWith('$ ');
  return (
    <>
      <Text color="gray">{stamp}</Text>
      {isCmd
        ? <Text color="cyan">{trunc(rest, restWidth)}</Text>
        : <><Text color="red">✗ </Text><Text color="white">{trunc(rest, restWidth - 2)}</Text></>}
    </>
  );
}

export function FullLogModal({ lines, viewKey, onClose }) {
  const { width, textWidth, maxRows } = useLogLayout(0);

  return (
    <LogViewer
      width={width} textWidth={textWidth} maxRows={maxRows}
      title={` Full Log — ${lines.length} line${lines.length !== 1 ? 's' : ''} `}
      titleColor="cyan"
      lines={lines}
      renderLine={renderFullLogLine}
      footerNote={`${LOG_FILE} — capped at the most recent 500 lines`}
      closeKey={viewKey}
      onClose={onClose}
    />
  );
}

// ── PullLogModal ──────────────────────────────────────────────────────────────
// Full scrollable output for an in-flight or just-finished pull/sync (see
// spawnUpdateInsertsAsync in core.js). Session-scoped, like ErrorLogModal —
// not persisted, since the full command output isn't meant to be a durable log.

export function PullLogModal({ pull, lines, cancelKey, viewKey, onCancel, onClose }) {
  const { width, textWidth, maxRows } = useLogLayout(1);

  useInput((input) => {
    if (!pull.done && input === cancelKey) onCancel();
  });

  const statusLabel = pull.done ? (pull.killed ? 'Cancelled' : pull.success ? 'Done' : 'Failed') : 'Running';
  const statusColor = pull.done ? (pull.success ? 'green' : 'red') : 'yellow';

  const header = (
    <Box>
      {!pull.done && <Spinner />}
      <Text color={statusColor}>{statusLabel} — {trunc(pull.cmd ?? '', textWidth - statusLabel.length - 4)}</Text>
    </Box>
  );

  return (
    <LogViewer
      width={width} textWidth={textWidth} maxRows={maxRows}
      title={` Pull/Sync — ${folderLabel(pull.target)} `}
      titleColor={statusColor}
      lines={lines}
      renderLine={(line, w) => <Text color="white">{trunc(line, w)}</Text>}
      header={header}
      footerNote={!pull.done ? `[${cancelKey}] cancel` : ''}
      closeKey={viewKey}
      onClose={onClose}
    />
  );
}

// ── KeybindingsModal ──────────────────────────────────────────────────────────

export function KeybindingsModal({ bindings, onSave, onCancel }) {
  const [local, setLocal] = useState(() =>
    Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, { ...v }])),
  );
  const entries = Object.entries(local);
  const [cursor,    setCursor]    = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [error,     setError]     = useState(null);

  useInput((input, key) => {
    if (capturing) {
      if (key.escape) { setCapturing(false); setError(null); return; }

      const captured = captureKey(input, key);
      if (!captured) {
        setError('That key is reserved (Esc/Enter/Tab/Arrows) and cannot be bound.');
        return;
      }

      const [action] = entries[cursor];
      const collision = findCollision(local, action, captured.key, captured.ctrl);
      if (collision) {
        const [colAction] = collision;
        const colLabel = DEFAULT_BINDINGS[colAction]?.label ?? colAction;
        setError(`"${bindingLabel(captured)}" is already used by "${colLabel}". Choose a different key.`);
        return;
      }

      setLocal(prev => ({
        ...prev,
        [action]: { ...prev[action], key: captured.key, ctrl: captured.ctrl },
      }));
      setCapturing(false);
      setError(null);
      return;
    }

    // List mode
    if (key.escape)                           { onCancel(); return; }
    if (input === 's')                        { onSave(local); return; }
    if (key.upArrow   || input === 'k')       { setCursor(c => Math.max(0, c - 1)); setError(null); return; }
    if (key.downArrow || input === 'j')       { setCursor(c => Math.min(entries.length - 1, c + 1)); setError(null); return; }
    if (key.return)                           { setCapturing(true); setError(null); return; }
    if (input === 'R') {
      setLocal(Object.fromEntries(
        Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, { ...v }]),
      ));
      setError(null);
      return;
    }
  });

  return (
    <Dialog title="⌨  Keybindings" titleColor="magenta" width={66}>
      {entries.map(([action, binding], i) => {
        const isActive = i === cursor;
        const label = DEFAULT_BINDINGS[action]?.label ?? action;
        return (
          <Box key={action}>
            <Text bold={isActive} color={isActive ? 'cyan' : 'gray'}>
              {isActive ? '▶ ' : '  '}
              {label.padEnd(24)}
            </Text>
            <Text bold={isActive} color={isActive && capturing ? 'yellow' : isActive ? 'white' : 'white'}>
              {isActive && capturing
                ? ' [ press a key… ]'
                : (' ' + bindingLabel(binding)).padEnd(14)}
            </Text>
          </Box>
        );
      })}

      {error ? (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="gray">
            {capturing
              ? 'Press any key to bind (Esc to cancel)'
              : 'Enter to rebind  ·  R to reset defaults  ·  s to save & close  ·  Esc to cancel'}
          </Text>
        </Box>
      )}

      <ButtonBar buttons={[
        { key: 'Enter', label: 'Rebind',          color: capturing ? 'yellow' : 'green' },
        { key: 'R',     label: 'Reset defaults',  color: 'yellow' },
        { key: 's',     label: 'Save & close',    color: 'green' },
        { key: 'Esc',   label: 'Cancel',          color: 'red' },
      ]} />
    </Dialog>
  );
}

// ── SyncFolderModal ───────────────────────────────────────────────────────────

export function SyncFolderModal({ folder, onConfirm, onCancel }) {
  useInput((input, key) => {
    if (key.escape || input === 'n') { onCancel(); return; }
    if (key.return || input === 'y') onConfirm();
  });

  const label = folderLabel(folder.name);

  return (
    <Dialog title={`↓  Sync '${label}' from portal`} titleColor="yellow" width={62}>
      <Text color="gray">Re-pull all tracked types into this folder.</Text>
      <Text color="gray">
        {folder.isActive
          ? 'This folder is currently loaded — the working copy is refreshed too.'
          : 'Other folders are not changed.'}
      </Text>
      <Box height={1} />
      <Text color="white">Folder: <Text bold color="yellow">{label}</Text></Text>
      <Text color="white">Items:  <Text color="gray">{folder.totalItems}</Text></Text>
      <Box height={1} />
      <Text color="gray">The current state is backed up first — restore it anytime via H.</Text>
      <ButtonBar buttons={[
        { key: 'Enter / y', label: 'Sync', color: 'yellow' },
        { key: 'Esc / n',   label: 'Cancel', color: 'red' },
      ]} />
    </Dialog>
  );
}

// ── SyncItemModal ─────────────────────────────────────────────────────────────

export function SyncItemModal({ item, typeName, folderName, env, onConfirm, onCancel }) {
  useInput((input, key) => {
    if (key.escape || input === 'n') { onCancel(); return; }
    if (key.return || input === 'y') onConfirm();
  });

  return (
    <Dialog title="↓  Refresh item from portal" titleColor="cyan" width={66}>
      <Row label="UUID:"   value={item.uuid} />
      <Row label="ID:"     value={item.displayId} />
      <Row label="Type:"   value={typeName} />
      <Row label="Folder:" value={folderLabel(folderName)} />
      <Row label="Env:"    value={env} />
      <Box height={1} />
      <Text color="gray">Fetches the latest version of this item and replaces the local copy.</Text>
      <Text color="gray">The current state is backed up first — restore it anytime via H.</Text>
      <ButtonBar buttons={[
        { key: 'Enter / y', label: 'Refresh', color: 'cyan' },
        { key: 'Esc / n',   label: 'Cancel', color: 'red' },
      ]} />
    </Dialog>
  );
}

// ── ItemSyncResultModal ───────────────────────────────────────────────────────
// Shown right after a single-item sync — a field-level "what changed" report,
// since UUID-set tracking can't tell you an item's contents changed underneath you.

function fmtFieldValue(v) {
  if (v === undefined) return '(absent)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export function ItemSyncResultModal({ item, changes, onClose }) {
  useInput((input, key) => {
    if (key.escape || input === 'q' || key.return) onClose();
  });

  const visible = changes.slice(0, 12);

  return (
    <Dialog title={`↓  Item synced — ${item.displayId}`} titleColor="cyan" width={80}>
      <Text color="gray">UUID: {item.uuid}</Text>
      <Box height={1} />
      {changes.length === 0 ? (
        <Text color="green">✓ No field changes — the local copy already matched the portal.</Text>
      ) : (
        <>
          <Text color="gray" bold>{changes.length} field{changes.length !== 1 ? 's' : ''} changed:</Text>
          {visible.map(c => (
            <Box key={c.field} flexDirection="column" marginTop={1}>
              <Text bold color="white">{c.field}</Text>
              <Box paddingLeft={2}>
                <Text color="red">- {trunc(fmtFieldValue(c.before), 90)}</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color="green">+ {trunc(fmtFieldValue(c.after), 90)}</Text>
              </Box>
            </Box>
          ))}
          {changes.length > 12 && (
            <Box marginTop={1}><Text color="gray">…and {changes.length - 12} more fields</Text></Box>
          )}
        </>
      )}
      <ButtonBar buttons={[{ key: 'Esc / Enter', label: 'Close', color: 'cyan' }]} />
    </Dialog>
  );
}

// ── SetQueryModal ─────────────────────────────────────────────────────────────

const TRACKING_ENVS = ['data', 'staging', 'devtest', 'wolf'];

export function SetQueryModal({ folder, onConfirm, onCancel }) {
  const [fieldIdx, setField]  = useState(0); // 0=env, 1=query
  const [ready,    setReady]  = useState(0);
  const [envIdx,   setEnvIdx] = useState(0);
  const [query,    setQuery]  = useState('');

  useEffect(() => { setReady(fieldIdx); }, [fieldIdx]);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.tab && !key.shift) { setField(f => (f + 1) % 2); return; }
    if (key.shift && key.tab)  { setField(f => (f - 1 + 2) % 2); return; }
    if (fieldIdx === 0) {
      if (key.leftArrow)  { setEnvIdx(i => Math.max(0, i - 1)); return; }
      if (key.rightArrow) { setEnvIdx(i => Math.min(TRACKING_ENVS.length - 1, i + 1)); return; }
      if (key.downArrow)  { setField(1); return; }
    }
    if (fieldIdx === 1 && key.return && query.trim()) {
      onConfirm({ env: TRACKING_ENVS[envIdx], query: query.trim() });
    }
  });

  const fc = fi => fieldIdx === fi ? 'cyan' : 'gray';

  return (
    <Dialog title={`⊙  Set tracking query — '${folderLabel(folder.name)}'`} titleColor="cyan" width={72}>
      <Text color="gray">
        Sets the portal query used for remote staleness checks and syncing.
      </Text>
      <Box height={1} />

      {/* Env slider */}
      <Box>
        <Text color={fc(0)}>{'Env    '}</Text>
        <Box gap={2}>
          {TRACKING_ENVS.map((e, i) => {
            const sel = i === envIdx;
            const foc = fieldIdx === 0;
            return (
              <Text key={e} bold={sel} color={sel && foc ? 'cyan' : sel ? 'white' : 'gray'}>
                {foc && sel ? `[ ${e} ]` : e}
              </Text>
            );
          })}
        </Box>
      </Box>

      {/* Query input */}
      <Box marginTop={1}>
        <Text color={fc(1)}>{'Query  '}</Text>
        {ready === 1
          ? <TextInput value={query} onChange={setQuery} placeholder="?type=FileSet&status=open" onSubmit={v => { if (v.trim()) onConfirm({ env: TRACKING_ENVS[envIdx], query: v.trim() }); }} />
          : <Text color={query ? 'white' : 'gray'}>{query || '?type=FileSet&status=open'}</Text>}
      </Box>

      <ButtonBar buttons={[
        { key: 'Enter', label: 'Save', color: 'green' },
        { key: 'Tab',   label: 'Next field', color: 'cyan' },
        { key: 'Esc',   label: 'Cancel', color: 'red' },
      ]} />
    </Dialog>
  );
}

// ── PullMoreModal ─────────────────────────────────────────────────────────────
// Adds items via a one-off query without touching the folder's stored
// tracking query — for growing a folder's contents, not redefining what `f`
// re-syncs going forward. update-inserts-from-server merges rather than
// replaces, so this is additive.

export function PullMoreModal({ folder, currentQuery, onConfirm, onCancel }) {
  const [fieldIdx, setField]  = useState(0); // 0=env, 1=query
  const [ready,    setReady]  = useState(0);
  const [envIdx,   setEnvIdx] = useState(0);
  const [query,    setQuery]  = useState('');
  const [queued,   setQueued] = useState([]); // queries already added to this batch

  useEffect(() => { setReady(fieldIdx); }, [fieldIdx]);

  // Enter on non-empty text adds it to the batch (chip-input style); Enter
  // on an already-empty field runs everything queued so far — so "type,
  // Enter, type, Enter, ..., Enter" both builds and runs the batch.
  const submitQuery = (value) => {
    const trimmed = value.trim();
    if (trimmed) {
      setQueued(prev => [...prev, trimmed]);
      setQuery('');
      return;
    }
    if (queued.length > 0) onConfirm({ env: TRACKING_ENVS[envIdx], queries: queued });
  };

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.tab && !key.shift) { setField(f => (f + 1) % 2); return; }
    if (key.shift && key.tab)  { setField(f => (f - 1 + 2) % 2); return; }
    if (fieldIdx === 0) {
      if (key.leftArrow)  { setEnvIdx(i => Math.max(0, i - 1)); return; }
      if (key.rightArrow) { setEnvIdx(i => Math.min(TRACKING_ENVS.length - 1, i + 1)); return; }
      if (key.downArrow)  { setField(1); return; }
    }
    if (fieldIdx === 1) {
      // TextInput's own onSubmit already handles Enter once it's mounted (ready === 1) —
      // only fall back to handling it here for the one-tick window before it mounts,
      // otherwise both fire and the query gets added twice.
      if (key.return && ready !== 1) { submitQuery(query); return; }
      if (key.backspace && !query) { setQueued(prev => prev.slice(0, -1)); return; } // remove last queued
    }
  });

  const fc = fi => fieldIdx === fi ? 'cyan' : 'gray';
  const enterLabel = query.trim() ? 'Add query' : (queued.length > 0 ? `Run ${queued.length}` : 'Add query');

  return (
    <Dialog title={`⊕  Pull more into '${folderLabel(folder.name)}'`} titleColor="cyan" width={76}>
      <Text color="gray">Adds matching items on top of what's already here — doesn't</Text>
      <Text color="gray">change the folder's tracked query, and existing items are kept.</Text>
      {currentQuery?.query && (
        <Text color="gray">Currently tracks: <Text color="white">{currentQuery.env} {trunc(currentQuery.query, 44)}</Text></Text>
      )}
      <Box height={1} />

      {/* Env slider */}
      <Box>
        <Text color={fc(0)}>{'Env    '}</Text>
        <Box gap={2}>
          {TRACKING_ENVS.map((e, i) => {
            const sel = i === envIdx;
            const foc = fieldIdx === 0;
            return (
              <Text key={e} bold={sel} color={sel && foc ? 'cyan' : sel ? 'white' : 'gray'}>
                {foc && sel ? `[ ${e} ]` : e}
              </Text>
            );
          })}
        </Box>
      </Box>

      {/* Queries queued so far */}
      {queued.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">Queued to run in order:</Text>
          {queued.map((q, i) => (
            <Box key={i} paddingLeft={2}>
              <Text color="white">{i + 1}. {trunc(q, 62)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Query input */}
      <Box marginTop={1}>
        <Text color={fc(1)}>{'Query  '}</Text>
        {ready === 1
          ? <TextInput value={query} onChange={setQuery} placeholder="?type=FileSet&status=open" onSubmit={submitQuery} />
          : <Text color={query ? 'white' : 'gray'}>{query || '?type=FileSet&status=open'}</Text>}
      </Box>

      <ButtonBar buttons={[
        { key: 'Enter',     label: enterLabel,      color: 'green' },
        { key: 'Backspace', label: 'Remove last',   color: 'yellow' },
        { key: 'Tab',       label: 'Env field',     color: 'cyan' },
        { key: 'Esc',       label: 'Cancel',        color: 'red' },
      ]} />
    </Dialog>
  );
}

// ── AnonymizeModal ────────────────────────────────────────────────────────────

export function AnonymizeModal({ folder, onConfirm, onCancel }) {
  const N_FIELDS = 2; // name=0  seed=1
  const [fieldIdx, setField] = useState(0);
  const [ready,    setReady] = useState(0); // lags fieldIdx by one tick — prevents mount race
  const [name,     setName]  = useState(`${folderLabel(folder.name)}-anon`);
  const [seed,     setSeed]  = useState('');

  useEffect(() => { setReady(fieldIdx); }, [fieldIdx]);

  const submit = () => onConfirm({ name: name.trim(), seed: seed.trim() || null });

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.tab && !key.shift) { setField(f => (f + 1) % N_FIELDS); return; }
    if (key.shift && key.tab)  { setField(f => (f - 1 + N_FIELDS) % N_FIELDS); return; }
  });

  const fc = fi => fieldIdx === fi ? 'cyan' : 'gray';

  return (
    <Dialog title={`⛭  Export de-identified copy — '${folderLabel(folder.name)}'`} titleColor="cyan" width={76}>
      <Text color="gray">Writes a copy to ~/smaht-im-exports/ — the working copy and</Text>
      <Text color="gray">every other folder are untouched. UUIDs are remapped, identifying</Text>
      <Text color="gray">fields scrubbed, and quasi-identifiers shuffled across records.</Text>
      <Text color="yellow">Review the output and _ANONYMIZATION_REPORT.json before sharing.</Text>
      <Box height={1} />

      <Box>
        <Text color={fc(0)}>{'Export name  '}</Text>
        {ready === 0
          ? <TextInput value={name} onChange={setName} onSubmit={submit} />
          : <Text color="white">{name}</Text>}
      </Box>

      <Box marginTop={1}>
        <Text color={fc(1)}>{'Seed (opt.)  '}</Text>
        {ready === 1
          ? <TextInput
              value={seed}
              onChange={setSeed}
              placeholder="blank = random, not reproducible"
              onSubmit={submit}
            />
          : <Text color={seed ? 'white' : 'gray'}>{seed || 'blank = random, not reproducible'}</Text>}
      </Box>

      <ButtonBar buttons={[
        { key: 'Enter', label: 'Export',     color: 'green' },
        { key: 'Tab',   label: 'Next field', color: 'cyan'  },
        { key: 'Esc',   label: 'Cancel',     color: 'red'   },
      ]} />
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
