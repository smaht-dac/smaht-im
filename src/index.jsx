/**
 * index.jsx — entry point for imc TUI
 *
 * Usage:
 *   node dist/imc.js
 *   (or: npm start  after npm run build)
 *
 * Add to ~/.bashrc:
 *   alias imc='node ~/smaht-im/dist/imc.js'
 */

import React from 'react';
import { render } from 'ink';
import { existsSync } from 'node:fs';
import App from './App.jsx';
import { INSERTS_BASE } from './core.js';

// Check prerequisites
if (!existsSync(INSERTS_BASE)) {
  console.error(`\nError: inserts directory not found:\n  ${INSERTS_BASE}\n`);
  console.error('Set SMAHT_REPO_ROOT to the root of your smaht-portal checkout.\n');
  process.exit(1);
}

// Enter alternate screen buffer (like vim/lazygit — hides on exit)
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT  = '\x1b[?1049l';
const HIDE_CURSOR      = '\x1b[?25l';
const SHOW_CURSOR      = '\x1b[?25h';

process.stdout.write(ALT_SCREEN_ENTER + HIDE_CURSOR);

function cleanup() {
  process.stdout.write(SHOW_CURSOR + ALT_SCREEN_EXIT);
}

process.on('exit',    cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

const { unmount, waitUntilExit } = render(<App />, {
  exitOnCtrlC: true,
});

waitUntilExit().then(() => {
  cleanup();
  process.exit(0);
});
