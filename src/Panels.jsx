/**
 * Panels.jsx — FolderPanel, TypePanel, ItemsPanel
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { INSERT_PREFIX, branchName } from './core.js';

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

/** Format a Date as YYYY-MM-DD in local time, or '—' if null. */
function fmtDate(d) {
  if (!d) return '—';
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

// ── FolderPanel ───────────────────────────────────────────────────────────────

export function FolderPanel({ folders, selectedIdx, onSelect, height, isFocused }) {

  useInput((input, key) => {
    if (!isFocused) return;
    if (key.upArrow   || input === 'k') onSelect(Math.max(0, selectedIdx - 1));
    if (key.downArrow || input === 'j') onSelect(Math.min(folders.length - 1, selectedIdx + 1));
  });

  // Dynamic width: fit longest branch name + date column, capped at 100
  // Overhead: border(2) + paddingX(2) + cursor(2) + active(2) + count(8) + date(12) = 28
  const DATE_W    = 12; // "  YYYY-MM-DD"
  const overhead  = 16 + DATE_W;
  const longestShortName = folders.reduce((max, f) => Math.max(max, branchName(f.name).length), 0);
  const panelWidth = Math.min(100, Math.max(36, longestShortName + overhead));
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
          {' Branches '}
        </Text>
        <Text color="gray">({folders.length})</Text>
      </Box>

      {/* Folder list */}
      {slice.map((folder, i) => {
        const realIdx = i + offset;
        const isSelected = realIdx === selectedIdx;
        const shortName = branchName(folder.name);

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
            <Text color="gray">  {fmtDate(folder.lastUpdated)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── OverviewPanel ─────────────────────────────────────────────────────────────

export function OverviewPanel({ folder, height }) {
  const label       = folder ? branchName(folder.name) : null;
  const lastUpdated = fmtDate(folder?.lastUpdated ?? null);
  const items       = folder ? String(folder.totalItems) : '—';

  return (
    <Box
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
    >
      <Box paddingX={1}>
        <Text bold color="white"> Overview </Text>
        {label && <Text color="gray">{label}</Text>}
      </Box>
      <Box paddingX={2} gap={4}>
        <Box>
          <Text color="gray">{'Last pulled  '}</Text>
          <Text color={folder ? 'white' : 'gray'}>{lastUpdated}</Text>
        </Box>
        <Box>
          <Text color="gray">{'Items  '}</Text>
          <Text color={folder ? 'white' : 'gray'}>{items}</Text>
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
