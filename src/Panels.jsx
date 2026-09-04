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
export function trunc(str, maxLen) {
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

/**
 * Return indicator text and color for a remote status entry. Only "behind"
 * (items on the portal that aren't local) is shown — "ahead" (local UUIDs
 * absent from the portal query) is computed but deliberately not surfaced:
 * a folder's tracking query is often narrower than everything it locally
 * holds (e.g. type-filtered while transitively-pulled linked types sit
 * alongside), so "ahead" routinely counts items that could never match the
 * query rather than genuinely stale ones — misleading more often than not.
 */
function remoteIndicator(rs) {
  if (!rs || rs.status === 'checking') return { text: '~',  color: 'gray'  };
  if (rs.status === 'untracked')       return { text: '?',  color: 'gray'  };
  if (rs.status === 'error')           return { text: '!',  color: 'red'   };
  if (rs.behind === 0) return { text: '✓', color: 'green' };
  return { text: '↓', color: 'yellow' };
}

export function FolderPanel({ folders, selectedIdx, onSelect, height, isFocused, remoteStatus }) {

  useInput((input, key) => {
    if (!isFocused) return;
    if (key.upArrow   || input === 'k') onSelect(Math.max(0, selectedIdx - 1));
    if (key.downArrow || input === 'j') onSelect(Math.min(folders.length - 1, selectedIdx + 1));
  });

  // Dynamic width: fit longest branch name + count + right-aligned remote indicator + age
  // Overhead: border(2) + paddingX(2) + cursor(2) + active(2) + count(8) + remote(1) + age(4) = 21
  const DATE_W   = 4;
  const REMOTE_W = 1; // indicator is always a single glyph: ~ ? ! ✓ ↓
  const overhead  = 20 + DATE_W + REMOTE_W;
  const longestShortName = folders.reduce((max, f) => Math.max(max, folderLabel(f.name).length), 0);
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
          {' Folders '}
        </Text>
        <Text color="gray">({folders.length})</Text>
      </Box>

      {/* Folder list */}
      {slice.map((folder, i) => {
        const realIdx = i + offset;
        const isSelected = realIdx === selectedIdx;
        const shortName = folderLabel(folder.name);
        const rs  = remoteStatus?.get(folder.name);
        const ind = remoteIndicator(rs);

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
            <Text color={ind.color}>{ind.text.padStart(REMOTE_W)}</Text>
            <Text color="gray">  {relativeTime(folder.lastUpdated)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── OverviewPanel ─────────────────────────────────────────────────────────────

const OVERVIEW_LABEL_WIDTH = 13;

function OverviewRow({ label, value }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(OVERVIEW_LABEL_WIDTH)}</Text>
      <Text dimColor>{value}</Text>
    </Box>
  );
}

export function OverviewPanel({ folder, envs, query, behind, syncKey, height }) {
  const label       = folder ? folderLabel(folder.name) : null;
  const lastUpdated = fmtFullDate(folder?.lastUpdated ?? null);
  const items       = folder ? String(folder.totalItems) : '—';
  const envsText    = envs && envs.length ? envs.join(', ') : '—';
  const queryText   = query || '—';
  const missing     = behind > 0
    ? `This folder is missing ${behind} insert${behind !== 1 ? 's' : ''} available on the live portal — press ${syncKey} to pull ${behind !== 1 ? 'them' : 'it'} down.`
    : '';

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
      <Box paddingX={2} flexDirection="column">
        <OverviewRow label="Last pulled" value={lastUpdated} />
        <OverviewRow label="Items" value={items} />
        <OverviewRow label="Env(s)" value={envsText} />
        <OverviewRow label="Query" value={queryText} />
        <Box>
          <Text color="yellow">{missing}</Text>
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

  // Dynamic width: fit the longest "name.json [count]" row, clamped to a sane range
  // so this panel never stretches to fill the row the way it did when it was flexGrow.
  const overhead = 2 /* border */ + 2 /* paddingX */ + 2 /* cursor */ + 7 /* " [999]" */;
  const longestName = types.reduce((max, t) => Math.max(max, (t.name + '.json').length), 6);
  const nameWidth  = Math.min(30, longestName);
  const panelWidth = Math.max(24, Math.min(44, nameWidth + overhead));

  const innerHeight = Math.max(1, height - 2);
  const { slice, offset } = visibleWindow(types, selectedIdx, innerHeight);

  return (
    <Box
      width={panelWidth}
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? 'green' : 'gray'}
    >
      {/* Title */}
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'green' : 'white'}> Types </Text>
        <Text color="gray">({types.length})</Text>
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

const UUID_W  = 18;
const ID_W    = 16; // accessions/submitted_ids are typically ~12-14 chars — was 26, leaving a wide gap before Title
const TITLE_W = 32;
const GAP     = 3;

// display_title is a computed property (only ever present on live portal
// responses, never in raw stored inserts); title is a real persisted field
// some types (e.g. Publication) define instead. Either is worth showing.
const itemTitle = (data) => data?.display_title ?? data?.title ?? null;

export function ItemsPanel({
  itype,
  selectedIdx,
  onSelect,
  selectedUuids,
  height,
  isFocused,
  hints,
}) {
  const items = itype?.items ?? [];
  const hasDisplayTitle = items.some(i => itemTitle(i.data));

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
      flexGrow={1}
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? 'green' : 'gray'}
    >
      {/* Title — wrap="truncate-end" everywhere in this panel: when the item
          detail panel is open it takes a fixed slice of width away from this
          one's flexGrow, and plain wrapping text onto extra terminal lines
          reads far worse here than losing the tail end of a row. */}
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'green' : 'white'} wrap="truncate-end">{title}</Text>
        {isFocused && (
          <Text color="gray" wrap="truncate-end">
            {' '}{hints?.select ?? 'Space'}=sel{'  '}
            {hints?.selectAll ?? 'ctrl+a'}=all{'  '}
            {hints?.move ?? 'm'}=move{'  '}Enter=view{'  '}Esc=clr
          </Text>
        )}
      </Box>

      {/* Column headers — the "▶ "/"● " cursor+select markers on each row
          add up to 4 columns of leading width, so the header needs the same
          4-space lead-in or its labels drift left of the values under them. */}
      {items.length > 0 && (
        <Box paddingX={2}>
          <Text color="gray" bold wrap="truncate-end">
            {'    '}
            {'UUID'.padEnd(UUID_W + GAP)}
            {'ID / Accession'.padEnd(ID_W + GAP)}
            {hasDisplayTitle && 'Title'.padEnd(TITLE_W + GAP)}
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
        const uuidShort = trunc(item.uuid, UUID_W);
        const idStr = trunc(item.displayId, ID_W);
        const titleStr = trunc(itemTitle(item.data), TITLE_W);
        const statusStr = trunc(item.status, 14);

        return (
          <Box key={item.uuid || realIdx} paddingX={2}>
            <Text
              bold={isCursor && isFocused}
              wrap="truncate-end"
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
              {uuidShort.padEnd(UUID_W + GAP)}
              {idStr.padEnd(ID_W + GAP)}
              {hasDisplayTitle && (titleStr || '—').padEnd(TITLE_W + GAP)}
              {statusStr}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── ItemDetailPanel ──────────────────────────────────────────────────────────

const ITEM_DETAIL_WIDTH = 56;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** { text, color } segments for a primitive JSON value — no key portion. */
function primitiveSegments(value) {
  if (value === null) return [{ text: 'null', color: 'gray' }];
  if (typeof value === 'boolean') return [{ text: String(value), color: 'magenta' }];
  if (typeof value === 'number') return [{ text: String(value), color: 'yellow' }];
  return [{ text: JSON.stringify(value), color: 'green' }];
}

/**
 * Recursively flattens a JSON value into one row per line the tree view can
 * render/cursor over. Each collapsible object/array contributes an opening
 * row (collapsed: one summary row with an item/key count; expanded: its
 * children flattened in as their own rows, plus a closing bracket row) —
 * the same shape a code editor's JSON outline uses. `path` is a stable
 * dotted key used only to look up/toggle collapse state in the `collapsed`
 * Set; it isn't shown.
 */
function flattenJson(value, path, depth, key, collapsed, rows) {
  const isArr = Array.isArray(value);
  const isObj = isPlainObject(value);
  const keySeg = key != null ? [{ text: `"${key}"`, color: 'cyan' }, { text: ': ', color: 'gray' }] : [];

  if (isArr || isObj) {
    const entries = isArr ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    const open  = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';
    if (entries.length === 0) {
      rows.push({ path, depth, collapsible: false, collapsed: false,
        segments: [...keySeg, { text: open + close, color: 'white' }] });
      return;
    }
    const isCollapsed = collapsed.has(path);
    const countLabel = isArr ? `${entries.length} item${entries.length !== 1 ? 's' : ''}`
                              : `${entries.length} key${entries.length !== 1 ? 's' : ''}`;
    rows.push({
      path, depth, collapsible: true, collapsed: isCollapsed,
      segments: isCollapsed
        ? [...keySeg, { text: open, color: 'white' }, { text: ` …${countLabel}… `, color: 'gray' }, { text: close, color: 'white' }]
        : [...keySeg, { text: open, color: 'white' }],
    });
    if (!isCollapsed) {
      for (const [k, v] of entries) flattenJson(v, `${path}.${k}`, depth + 1, isArr ? null : k, collapsed, rows);
      rows.push({ path: `${path}.$close`, depth, collapsible: false, collapsed: false, segments: [{ text: close, color: 'white' }] });
    }
    return;
  }

  rows.push({ path, depth, collapsible: false, collapsed: false, segments: [...keySeg, ...primitiveSegments(value)] });
}

/** Truncate a list of colored segments to a total plain-text width, preserving color boundaries. */
function truncSegments(segments, maxLen) {
  let used = 0;
  const out = [];
  for (const seg of segments) {
    if (used >= maxLen) break;
    const remaining = maxLen - used;
    if (seg.text.length <= remaining) {
      out.push(seg);
      used += seg.text.length;
    } else {
      out.push({ text: trunc(seg.text, remaining), color: seg.color });
      used = maxLen;
    }
  }
  return out;
}

/**
 * Collapsible, scrollable JSON tree for one item, shown to the right of
 * ItemsPanel on Enter. Controlled like every other panel here — selectedIdx
 * (cursor into the flattened row list) and collapsed (which node paths are
 * folded) both live in App.jsx state; this component only flattens/renders
 * and reports intent via onSelect/onCollapsedChange.
 */
export function ItemDetailPanel({ item, height, width = ITEM_DETAIL_WIDTH, isFocused, selectedIdx, onSelect, collapsed, onCollapsedChange, inModal = false }) {
  const innerWidth = width - 4; // border(2) + paddingX(2)
  const innerHeight = Math.max(1, height - 3); // border(2) + title row

  const rows = [];
  flattenJson(item.data ?? item, 'root', 0, null, collapsed, rows);

  // selectedIdx (App-owned) can go stale the instant collapse/expand changes
  // how many rows there are — e.g. "collapse all" can shrink rows out from
  // under whatever index was current. Every read below goes through this
  // clamped value instead of the raw prop, so movement/toggle/collapse-all
  // all agree on "the row actually on screen" even the same tick rows shrinks.
  const clampedIdx = Math.min(selectedIdx, Math.max(0, rows.length - 1));

  useInput((input, key) => {
    if (!isFocused) return;
    if (key.upArrow   || input === 'k') onSelect(Math.max(0, clampedIdx - 1));
    if (key.downArrow || input === 'j') onSelect(Math.min(rows.length - 1, clampedIdx + 1));
    if (key.return || input === ' ') {
      const row = rows[clampedIdx];
      if (!row?.collapsible) return;
      const next = new Set(collapsed);
      if (next.has(row.path)) next.delete(row.path); else next.add(row.path);
      onCollapsedChange(next);
    }
    if (input === 'c') {
      const all = new Set();
      const collect = (v, path) => {
        if (Array.isArray(v)) { all.add(path); v.forEach((c, i) => collect(c, `${path}.${i}`)); }
        else if (isPlainObject(v)) { all.add(path); Object.entries(v).forEach(([k, c]) => collect(c, `${path}.${k}`)); }
      };
      collect(item.data ?? item, 'root');
      onCollapsedChange(all);
    }
  }, { isActive: isFocused });

  const { slice, offset } = visibleWindow(rows, clampedIdx, innerHeight);

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? 'green' : 'cyan'}
    >
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'green' : 'cyan'} wrap="truncate-end">{trunc(item.displayId || item.uuid || '', width - 4)}</Text>
      </Box>
      {isFocused && (
        <Box paddingX={1}>
          <Text color="gray" wrap="truncate-end">
            Enter/Space=toggle  c=collapse  {inModal ? 'z/Esc=close' : 'z=full  Esc=close'}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" paddingX={1}>
        {slice.map((row, i) => {
          const realIdx = i + offset;
          const isCursor = isFocused && realIdx === clampedIdx;
          const indent = '  '.repeat(row.depth);
          const marker = row.collapsible ? (row.collapsed ? '▸ ' : '▾ ') : '  ';
          const prefix = [{ text: indent + marker, color: 'gray' }];
          const segments = [...prefix, ...row.segments];
          const shown = truncSegments(segments, innerWidth);
          if (isCursor) {
            // A faint backdrop behind just the text itself — NOT padded out
            // to the full row width. A named ANSI color's darkest non-black
            // background option is "gray" (an alias for blackBright), which
            // read as too strong; this hex is deliberately darker than that
            // palette offers. Each segment keeps its own syntax color rather
            // than being flattened to one, so the highlight sits behind the
            // tree instead of fighting its colors. wrap="truncate-end" is a
            // hard backstop against ever spilling onto a second line — the
            // padded full-width version of this used to do exactly that.
            return (
              <Box key={row.path + i}>
                {shown.map((seg, si) => (
                  <Text key={si} backgroundColor="#303030" color={seg.color} wrap="truncate-end">{seg.text}</Text>
                ))}
              </Box>
            );
          }
          return (
            <Box key={row.path + i}>
              {shown.map((seg, si) => (
                <Text key={si} color={seg.color} wrap="truncate-end">{seg.text}</Text>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

const SPIN_FRAMES = ['|', '/', '-', '\\'];

export function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % SPIN_FRAMES.length), 120);
    return () => clearInterval(id);
  }, []);
  return <Text color="yellow">{SPIN_FRAMES[frame]} </Text>;
}

// ── ErrorLogPanel ─────────────────────────────────────────────────────────────

export function ErrorLogPanel({ errors, pulling, height, expandHint }) {
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
        <Box flexGrow={1} />
        {expandHint && <Text color="gray">[{expandHint}] expand</Text>}
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
