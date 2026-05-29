/**
 * Panels.jsx — FolderPanel, TypePanel, ItemsPanel
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { INSERT_PREFIX, folderLabel } from './core.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Return a visible slice of items centered on selectedIdx. */
function visibleWindow(items, selectedIdx, maxRows) {
  if (items.length <= maxRows) return { slice: items, offset: 0 };
  const half = Math.floor(maxRows / 2);
  const offset = Math.max(0, Math.min(selectedIdx - half, items.length - maxRows));
  return { slice: items.slice(offset, offset + maxRows), offset };
}

/** Truncate a string to maxLen, appending '…' if needed. */
function trunc(str, maxLen) {
  if (!str || str.length <= maxLen) return str ?? '';
  return str.slice(0, maxLen - 1) + '…';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Format a Date as "Month D, YYYY" in local time, or '—' if null. */
function fmtFullDate(d) {
  if (!d) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Return a compact relative-time string: 5m, 3h, 1d, 2w, 4mo, 2y — or '—' if null. */
function relativeTime(d) {
  if (!d) return '—';
  const ms     = Date.now() - d.getTime();
  const mins   = Math.floor(ms / 60_000);
  const hours  = Math.floor(ms / 3_600_000);
  const days   = Math.floor(ms / 86_400_000);
  const weeks  = Math.floor(days / 7);
  const months = Math.floor(days / 30.44);
  const years  = Math.floor(days / 365.25);
  if (years  >= 1) return `${years}y`;
  if (months >= 1) return `${months}mo`;
  if (weeks  >= 1) return `${weeks}w`;
  if (days   >= 1) return `${days}d`;
  if (hours  >= 1) return `${hours}h`;
  return `${Math.max(1, mins)}m`;
}

// ── FolderPanel ───────────────────────────────────────────────────────────────

export function FolderPanel({ folders, selectedIdx, onSelect, height, isFocused }) {

  useInput((input, key) => {
    if (!isFocused) return;
    if (key.upArrow   || input === 'k') onSelect(Math.max(0, selectedIdx - 1));
    if (key.downArrow || input === 'j') onSelect(Math.min(folders.length - 1, selectedIdx + 1));
  });

  // Dynamic width: fit longest branch name + count + right-aligned age, capped at 100
  // Overhead: border(2) + paddingX(2) + cursor(2) + active(2) + count(8) + age(4) = 20
  const DATE_W    = 4; // "11mo" — longest relative-time token (right-aligned, no prefix)
  const overhead  = 16 + DATE_W;
  const longestShortName = folders.reduce((max, f) => Math.max(max, folderLabel(f.name).length), 0);
  const panelWidth = Math.min(100, Math.max(30, longestShortName + overhead));
  const nameWidth  = panelWidth - overhead;

  const innerHeight = Math.max(1, height - 2); // subtract border rows
  const { slice, offset } = visibleWindow(folders, selectedIdx, innerHeight);

  return (
    <Box
      width={panelWidth}
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? 'green' : 'gray'}
    >
      {/* Title bar */}
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'green' : 'white'}>
          {' Folders '}
        </Text>
        <Text color="gray">({folders.length})</Text>
      </Box>

      {/* Folder list */}
      {slice.map((folder, i) => {
        const realIdx = i + offset;
        const isSelected = realIdx === selectedIdx;
        const shortName = folderLabel(folder.name);

        return (
          <Box key={folder.name} paddingX={1}>
            <Text
              bold={isSelected && isFocused}
              color={
                isSelected && isFocused
                  ? 'green'
                  : isSelected
                  ? 'white'
                  : 'gray'
              }
            >
              {isSelected ? '▶ ' : '  '}
              {folder.isActive ? '● ' : '  '}
              {trunc(shortName, nameWidth)}
            </Text>
            <Text color="gray"> [{folder.totalItems}]</Text>
            <Box flexGrow={1} />
            <Text color="gray">{relativeTime(folder.lastUpdated)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── OverviewPanel ─────────────────────────────────────────────────────────────

export function OverviewPanel({ folder, height }) {
  const label       = folder ? folderLabel(folder.name) : null;
  const lastUpdated = fmtFullDate(folder?.lastUpdated ?? null);
  const items       = folder ? String(folder.totalItems) : '—';

  return (
    <Box
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
    >
      <Box paddingX={1}>
        <Text dimColor> Overview </Text>
        {label && <Text dimColor>{label}</Text>}
      </Box>
      <Box paddingX={2} gap={4}>
        <Box>
          <Text dimColor>Last pulled  </Text>
          <Text dimColor>{lastUpdated}</Text>
        </Box>
        <Box>
          <Text dimColor>Items  </Text>
          <Text dimColor>{items}</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── TypePanel ─────────────────────────────────────────────────────────────────

export function TypePanel({ folder, selectedIdx, onSelect, height, isFocused }) {
  const types = folder?.types ?? [];

  useInput((input, key) => {
    if (!isFocused) return;
    if (key.upArrow   || input === 'k') onSelect(Math.max(0, selectedIdx - 1));
    if (key.downArrow || input === 'j') onSelect(Math.min(types.length - 1, selectedIdx + 1));
  });

  const innerHeight = Math.max(1, height - 2);
  const { slice, offset } = visibleWindow(types, selectedIdx, innerHeight);
  const title = folder ? trunc(folder.name, 36) : '—';

  return (
    <Box
      flexGrow={1}
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? 'green' : 'gray'}
    >
      {/* Title */}
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'green' : 'white'}> Types </Text>
        <Text color="gray">{folder ? `in ${title}` : ''}</Text>
      </Box>

      {!folder && (
        <Box paddingX={2}>
          <Text color="gray">No folder selected</Text>
        </Box>
      )}

      {types.length === 0 && folder && (
        <Box paddingX={2}>
          <Text color="gray">(empty — no .json files)</Text>
        </Box>
      )}

      {slice.map((t, i) => {
        const realIdx = i + offset;
        const isSelected = realIdx === selectedIdx;
        return (
          <Box key={t.name} paddingX={1}>
            <Text
              bold={isSelected && isFocused}
              color={isSelected && isFocused ? 'green' : isSelected ? 'white' : 'gray'}
            >
              {isSelected ? '▶ ' : '  '}
              {trunc(t.name + '.json', 30)}
            </Text>
            <Text color={t.count === 0 ? 'red' : 'gray'}> [{t.count}]</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── ItemsPanel ────────────────────────────────────────────────────────────────

export function ItemsPanel({
  itype,
  selectedIdx,
  onSelect,
  selectedUuids,
  height,
  isFocused,
}) {
  const items = itype?.items ?? [];

  useInput((input, key) => {
    if (!isFocused) return;
    if (key.upArrow   || input === 'k') onSelect(Math.max(0, selectedIdx - 1));
    if (key.downArrow || input === 'j') onSelect(Math.min(items.length - 1, selectedIdx + 1));
  });

  const innerHeight = Math.max(1, height - 3); // title + header row + border
  const { slice, offset } = visibleWindow(items, selectedIdx, innerHeight);
  const selCount = selectedUuids.size;

  const titleSuffix = selCount > 0 ? ` — ${selCount} selected` : '';
  const title = itype ? ` Items in ${trunc(itype.name, 20)}.json${titleSuffix} ` : ' Items ';

  return (
    <Box
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? 'green' : 'gray'}
    >
      {/* Title */}
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'green' : 'white'}>{title}</Text>
        {isFocused && (
          <Text color="gray"> Space=sel  ctrl+a=all  m=move  Esc=clr</Text>
        )}
      </Box>

      {/* Column headers */}
      {items.length > 0 && (
        <Box paddingX={1}>
          <Text color="gray" bold>
            {'  '}
            {'UUID'.padEnd(20)}
            {'ID / Accession'.padEnd(30)}
            {'Status'}
          </Text>
        </Box>
      )}

      {!itype && (
        <Box paddingX={2}>
          <Text color="gray">No type selected</Text>
        </Box>
      )}

      {itype && items.length === 0 && (
        <Box paddingX={2}>
          <Text color="gray">(empty)</Text>
        </Box>
      )}

      {slice.map((item, i) => {
        const realIdx = i + offset;
        const isCursor = realIdx === selectedIdx;
        const isSelected = selectedUuids.has(item.uuid);
        const uuidShort = trunc(item.uuid, 18);
        const idStr = trunc(item.displayId, 28);
        const statusStr = trunc(item.status, 14);

        return (
          <Box key={item.uuid || realIdx} paddingX={1}>
            <Text
              bold={isCursor && isFocused}
              color={
                isCursor && isFocused
                  ? 'green'
                  : isSelected
                  ? 'yellow'
                  : 'white'
              }
            >
              {isCursor ? '▶ ' : '  '}
              {isSelected ? '● ' : '  '}
              {uuidShort.padEnd(18)}
              {'  '}
              {idStr.padEnd(28)}
              {'  '}
              {statusStr}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

const SPIN_FRAMES = ['|', '/', '-', '\\'];

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % SPIN_FRAMES.length), 120);
    return () => clearInterval(id);
  }, []);
  return <Text color="yellow">{SPIN_FRAMES[frame]} </Text>;
}

// ── ErrorLogPanel ─────────────────────────────────────────────────────────────

export function ErrorLogPanel({ errors, pulling, height }) {
  const hasRealErr = errors.some(e => !e.startsWith('$ '));
  const hasAny     = errors.length > 0 || !!pulling;
  // Reserve a row for the spinner line when pulling; rest go to log entries
  const spinnerRows = pulling ? 1 : 0;
  const innerRows   = Math.max(0, height - 3 - spinnerRows); // -2 borders -1 title
  const visible     = errors.slice(-innerRows);

  return (
    <Box
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor={hasRealErr ? 'red' : pulling ? 'yellow' : 'gray'}
    >
      <Box paddingX={1}>
        {hasRealErr
          ? <Text bold color="red"> Errors ({errors.filter(e => !e.startsWith('$ ')).length}) </Text>
          : pulling
          ? <Text bold color="yellow"> Pulling… </Text>
          : <Text dimColor> Log </Text>}
      </Box>
      {!hasAny && (
        <Box paddingX={2}>
          <Text dimColor>No entries</Text>
        </Box>
      )}
      {pulling && (
        <Box paddingX={1}>
          <Spinner />
          <Text color="yellow">{trunc(pulling, 114)}</Text>
        </Box>
      )}
      {visible.map((e, i) => {
        const isCmd = e.startsWith('$ ');
        return (
          <Box key={i} paddingX={1}>
            {isCmd
              ? <Text color="cyan">{trunc(e, 120)}</Text>
              : <><Text color="red">✗ </Text><Text color="white">{trunc(e, 116)}</Text></>}
          </Box>
        );
      })}
    </Box>
  );
}
