/**
 * Regression coverage for FolderPanel's focus highlighting (border/text
 * turning green when isFocused). A recent change to mute the collapsed
 * strip's colors (see "Collapsible Folders panel" in CLAUDE.md) briefly
 * dropped isFocused-reactivity entirely; this pins down the fix so that
 * can't silently regress again.
 *
 * Renders with ink-testing-library and asserts on the actual ANSI escape
 * codes chalk/Ink emit, verified directly (not guessed) via a throwaway
 * spike before writing this: green foreground is "\x1b[32m", gray (chalk's
 * "gray" = ansi "bright black") is "\x1b[90m", dimColor is "\x1b[2m". Color
 * output is normally suppressed outside a real TTY, so FORCE_COLOR must be
 * set before ink/react/ink-testing-library are first imported in this
 * process, same reasoning and same dynamic-import-after-setting-it pattern
 * test/helpers/env.js already uses for HOME/SMAHT_REPO_ROOT.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempEnv } from './helpers/env.js';
import { importJsx } from './helpers/compileJsx.js';

useTempEnv();
process.env.FORCE_COLOR = '1';

const React = (await import('react')).default;
const { Box, Text } = await import('ink');
const { render } = await import('ink-testing-library');
const { FolderPanel } = await importJsx(fileURLToPath(new URL('../src/Panels.jsx', import.meta.url)));

const GREEN = '\x1b[32m';
const GRAY  = '\x1b[90m';
const DIM   = '\x1b[2m';

const folders = [
  { name: 'temp-local-inserts-devtest', totalItems: 3, isActive: true, lastUpdated: null, types: [] },
];

function renderFolderPanel(props) {
  return render(
    React.createElement(FolderPanel, {
      folders,
      selectedIdx: 0,
      onSelect: () => {},
      height: 10,
      remoteStatus: new Map(),
      selectedNames: new Set(),
      ...props,
    }),
  ).lastFrame();
}

describe('FolderPanel focus highlighting, collapsed', () => {
  test('focused: border and bracketed key both turn green', () => {
    const frame = renderFolderPanel({ isFocused: true, collapsed: true, toggleKey: 'o' });
    assert.match(frame, /\[o\]/);
    assert.ok(frame.includes(GREEN), 'expected green (\\x1b[32m) somewhere in the focused frame');
  });

  test('unfocused: border is gray, key text is dim, neither is green', () => {
    const frame = renderFolderPanel({ isFocused: false, collapsed: true, toggleKey: 'o' });
    assert.match(frame, /\[o\]/);
    assert.ok(frame.includes(GRAY), 'expected gray (\\x1b[90m) border in the unfocused frame');
    assert.ok(frame.includes(DIM), 'expected dimColor (\\x1b[2m) key text in the unfocused frame');
    assert.ok(!frame.includes(GREEN), 'unfocused frame should not contain green anywhere');
  });

  test('width fits the current binding fully: a longer rebound key is never truncated', () => {
    const frame = renderFolderPanel({ isFocused: false, collapsed: true, toggleKey: '^F' });
    assert.match(frame, /\[\^F\]/);
  });

  // Regression test: App.jsx renders this panel as a row-sibling of a
  // flexGrow={1} right column. Without flexShrink={0}, Yoga's default
  // flexShrink (1, same as CSS flexbox) would squeeze this panel below its
  // own computed width whenever the terminal is too narrow to fit both
  // sides in full, wrapping the bracketed key onto multiple lines instead
  // of keeping it on one. Reproduce that exact sibling layout here rather
  // than rendering FolderPanel alone, since the bug only appears under
  // real space pressure from a competing flex sibling.
  test('never wraps the bracketed key onto a second line, even under space pressure from a flex sibling', () => {
    const frame = render(
      React.createElement(
        Box,
        { flexDirection: 'row', width: 20 },
        React.createElement(FolderPanel, {
          folders,
          selectedIdx: 0,
          onSelect: () => {},
          height: 10,
          remoteStatus: new Map(),
          selectedNames: new Set(),
          isFocused: false,
          collapsed: true,
          toggleKey: 'Delete',
        }),
        React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, null, 'x'.repeat(50))),
      ),
    ).lastFrame();
    assert.match(frame, /\[Delete\]/);
  });
});

describe('FolderPanel focus highlighting, expanded', () => {
  test('focused: border and title turn green', () => {
    const frame = renderFolderPanel({ isFocused: true, collapsed: false });
    assert.ok(frame.includes(GREEN), 'expected green (\\x1b[32m) somewhere in the focused frame');
  });

  test('unfocused: border is gray, nothing is green', () => {
    const frame = renderFolderPanel({ isFocused: false, collapsed: false });
    assert.ok(frame.includes(GRAY), 'expected gray (\\x1b[90m) border in the unfocused frame');
    assert.ok(!frame.includes(GREEN), 'unfocused frame should not contain green anywhere');
  });
});
