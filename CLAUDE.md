# CLAUDE.md — smaht-im

Developer context for Claude Code. Read this before making any changes.

## What this project is

Two tools for managing smaht-portal inserts during local development:

- **`im`** — Python CLI (`im.py`). Wraps `update-inserts-from-server`. Stable, rarely changed.
- **`imc`** — Node.js TUI (`src/`). Lazygit-style three-panel interface. This is the active focus.

The tools read from and write to the inserts data directory inside a local smaht-portal checkout:
```
~/dbmi/smaht-portal/src/encoded/tests/data/
```
Overridden at runtime via `SMAHT_REPO_ROOT` env var.

## Safety invariant — never break this

**Only directories whose names start with `temp-local-inserts` may be created, modified, or deleted.**

The live portal repo also contains `master-inserts`, `workbook-inserts`, etc. — these must never be touched. Every write operation in `src/core.js` has an explicit guard. Do not remove those guards.

The directory named exactly `temp-local-inserts` (no suffix) is the **active folder** — the one the portal actually loads. It may be read or have its contents replaced, but it must never be deleted.

## Build workflow

```bash
cd ~/smaht-im
npm run build   # esbuild → dist/imc.js (~35 kB), takes ~20ms
npm run watch   # same but rebuilds on every file save
npm run dev     # build + watch + node --watch-path=dist (restarts on rebuild)
npm start       # run the already-built dist/imc.js
```

The alias in `~/.bashrc`:
```bash
alias imc='source ~/.nvm/nvm.sh && nvm use 24 --silent && node ~/smaht-im/dist/imc.js'
```

**Always run `npm run build` after editing any `src/` file.** The alias runs `dist/imc.js`, not the source.

Node version is pinned to 24 LTS (Krypton) via `.nvmrc`. Do not change this without a reason.

esbuild flags that matter:
- `--bundle` — inline all local `./` imports
- `--packages=external` — keep `node_modules` as runtime imports (ink is pure ESM, can't bundle)
- `--format=esm` — required because ink is pure ESM; CJS output would fail at runtime

## Source file map

```
src/
  index.jsx    Entry point. Checks INSERTS_BASE exists, sets up alt screen buffer
               (enter/exit like vim/lazygit), renders <App />.
  core.js      Pure data layer. All fs operations. No React. Sync I/O.
  App.jsx      All application state + global keybindings. Renders either the
               main 3-panel layout or a single modal (never both).
  Panels.jsx   FolderPanel, TypePanel, ItemsPanel — dumb display + local nav.
  Modals.jsx   ActivateModal, SnapshotModal, DeleteModal, MoveModal,
               DiffModal, HelpModal, NotificationBar.
```

## Architecture: how state flows

All state lives in `App.jsx`. Panels and modals receive state as props and call callbacks — they own nothing. The pattern:

```
App state
  folders[]       ← loaded by loadAllFolders() on mount and on r(efresh)
  folderIdx       ← which folder is highlighted in FolderPanel
  typeIdx         ← which type is highlighted in TypePanel
  itemIdx         ← which item is highlighted in ItemsPanel
  selectedUuids   ← Set of UUIDs marked with Space
  focus           ← 'folders' | 'types' | 'items'  (drives isFocused prop)
  modal           ← null | string key  (when set, main layout is replaced by modal)
  notification    ← null | { msg, isError }  (auto-clears after 4 s)
```

Derived state (computed inline, not stored):
```
currentFolder = folders[folderIdx]
currentType   = currentFolder.types[typeIdx]
currentItems  = currentType.items
activeFolder  = folders.find(f => f.isActive)
```

## Focus management

**Do not use Ink's `useFocus` / `useFocusManager`.** The panels manage focus via a plain `focus` string in App state, passed down as an `isFocused` boolean prop. This gives full control without fighting Ink's focus cycle.

In each panel:
```jsx
useInput((input, key) => {
  if (!isFocused) return;   // ← guard at the top, always
  // ... panel-specific navigation
}, { isActive: isFocused });
```

Focus cycling (Tab / l / h) is handled entirely in App's global `useInput`.

## Adding a new action / keybinding

1. Add the key handler in App's `useInput` block (bottom of the handler, after existing checks).
2. If it needs a modal: add a `modal === 'yourmodal'` case in the modal render block, create the component in `Modals.jsx`, add a `handleYourAction` callback in App.
3. Add an entry to the `actions` array in `Footer` if the shortcut should appear in the footer bar.
4. Add an entry to `HELP_ROWS` in `Modals.jsx` for the help screen.

## Adding a new modal

Modals replace the entire layout. The pattern in `Modals.jsx`:
```jsx
export function MyModal({ ...props, onConfirm, onCancel }) {
  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    // specific keys to confirm
  });
  return (
    <Dialog title="…" titleColor="cyan" width={64}>
      {/* content */}
      <ButtonBar buttons={[...]} />
    </Dialog>
  );
}
```

In `App.jsx`:
- Add `modal === 'mymodal'` to the modal render block
- Add a `handleMyAction` function that calls `setModal(null)`, runs the operation, calls `notify()`, then `refresh()`
- Pass `onConfirm={handleMyAction} onCancel={() => setModal(null)}`

## core.js conventions

- All exports are plain functions — no classes, no state.
- All I/O is synchronous (`fs.readFileSync`, `fs.cpSync`, `fs.rmSync`).
- Every write function validates that its target name starts with `INSERT_PREFIX` before touching the filesystem. Do not skip this.
- `loadFolder(name)` returns `null` if the directory doesn't exist — callers must handle null.
- `loadAllFolders()` always puts the active folder (`temp-local-inserts`) first.
- Item shape returned by `loadFolder`:
  ```js
  {
    name: 'temp-local-inserts-devtest',
    path: '/abs/path/to/folder',
    isActive: false,
    totalItems: 48,
    types: [
      { name: 'donor', count: 4, items: [{ uuid, displayId, status, data }] }
    ]
  }
  ```

## Layout math (App.jsx)

The TUI fills the full terminal. Heights are calculated from `stdout.rows`:
```
contentHeight = termHeight - footerHeight(3) - notifHeight(0 or 1)
typesPanelH   = floor(contentHeight * 0.35)
itemsPanelH   = contentHeight - typesPanelH
```

Each panel subtracts its border rows from height before computing `visibleWindow`. If you add a new row to a panel's header, reduce `innerHeight` by 1 to compensate.

## Panels: scrolling

`visibleWindow(items, selectedIdx, maxRows)` in `Panels.jsx` returns a centered slice. It is pure and has no side effects. Do not replace it with a stateful scroll offset — the current approach keeps scrolling automatic.

## What not to change without good reason

- The `--format=esm` esbuild flag — changing to CJS breaks at runtime because ink is ESM-only.
- The alt screen escape sequences in `index.jsx` — they give the vim/lazygit feel; removing them makes the TUI trash the terminal history.
- The safety guards in `core.js` (`startsWith(INSERT_PREFIX)` checks).
- The `"type": "module"` in `package.json` — the whole project is ESM.

## Running in dev

```bash
# Terminal 1 — auto-rebuild on save
cd ~/smaht-im && npm run watch

# Terminal 2 — run the TUI (re-launch after each rebuild)
imc
```

Or use `npm run dev` which does both but restarts the TUI process automatically (node --watch-path).
