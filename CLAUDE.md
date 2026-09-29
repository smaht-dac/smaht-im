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
Overridden at runtime via `SMAHT_REPO_ROOT` env var. **Only the active working copy (`temp-local-inserts`) and real portal fixtures (`master-inserts`, `workbook-inserts`, etc.) live here** — named branches (`temp-local-inserts-<slug>`) live outside the checkout entirely, at `~/.smaht-im/branches/<slug>/` (`BRANCHES_BASE` in `src/core.js`). See "core.js conventions" below for how path resolution works, and "Branch storage lives outside the repo" further down for why.

## Safety invariant — never break this

**Only directories whose names start with `temp-local-inserts` may be created, modified, or deleted.**

The live portal repo also contains `master-inserts`, `workbook-inserts`, etc. — these must never be touched. Every write operation in `src/core.js` has an explicit guard. Do not remove those guards.

The directory named exactly `temp-local-inserts` (no suffix) is the **active folder** — the one the portal actually loads. It may be read or have its contents replaced, but it must never be deleted. It's also the only insert-folder that still lives inside the portal checkout at all — branches don't, so for branch operations this guard is defense-in-depth rather than the primary safety mechanism (see below).

## Data safety: treat every live pull as potentially protected

Everything `im`/`imc` pull from a live portal environment (the `temp-local-inserts*` working copy and branches, their `~/.smaht-im/backups/` snapshots, and anything copied out via `y`) is real data sourced from an actual SMaHT portal environment. Depending on the environment and query, that can include donor, tissue, and sample records tied to real human subjects, the kind of data class that SMaHT and NIH Common Fund programs generally treat as controlled-access and potentially protected, not public information, even when nothing in the raw JSON is literally labeled PHI.

**Treat it as protected by default. Never assume a given pull is "probably fine to share" just because nothing looks obviously sensitive at a glance.** Concretely, local pulled data in its raw, non-anonymized form must never:

- be committed to this or any other git repository, including as a fixture, example, or test file
- be pasted into a GitHub issue, PR description, PR comment, Slack message, email, or support ticket
- be uploaded to a third-party service (a pastebin, a cloud drive, an AI tool's file upload, a bug-tracker attachment) in raw form
- appear in a screenshot, screen recording, or presentation slide, unless the data shown is from a recognized public reference/benchmark dataset (e.g. the COLO829T cell line) rather than a real donor pull
- leave the machine it was pulled onto by any other means not covered above

The one sanctioned way to share pulled data outside your own machine is the anonymization pathway (`e` in imc, or `scripts/anonymize-inserts.js`, see [Anonymized export](#anonymized-export) below and the README's "Sharing inserts data safely" section for exactly what it does and does not cover). Even that output still needs a human sign-off before it leaves the team, real data governance (DUA, DAC approval, IRB as applicable), not just this tool's say-so.

**For Claude Code or any other AI assistant working in this repo:** if asked to include real pulled insert data in a commit, PR, issue, doc, chat message, or any other artifact meant to leave this machine, don't, point to the anonymization tooling above instead, or ask the person to confirm the data shown is from a public reference dataset first. This applies to log excerpts and error messages too, since `imc.log` and the in-app error log can echo back fragments of what was pulled.

## Branch storage lives outside the repo

Named branches (`temp-local-inserts-<slug>`) physically live at `~/.smaht-im/branches/<slug>/` (`BRANCHES_BASE`), not inside the portal checkout. Only the literal working copy (`temp-local-inserts`) lives in `INSERTS_BASE` — the portal/tests read it there, so it can't move.

Why: branches are purely imc's own bookkeeping (the portal never reads them directly), so there's no reason for them to sit next to real fixtures like `master-inserts`/`workbook-inserts`. Moving them out removes that whole "could this accidentally touch a real fixture" risk class for every branch operation. This mirrors what already existed for backups (`~/.smaht-im/backups/`) and manifests (`~/.smaht-im/{folderName}.json`) — both were already outside the repo before branches followed.

`resolveFolderPath(name)` in `src/core.js` is the single place that decides which base a name resolves to — see "core.js conventions" above. If you're adding a new function that touches a folder by name, use it; don't reintroduce a raw `path.join(INSERTS_BASE, ...)`.

**`im.py` was deliberately left untouched.** It has no branch/active distinction of its own — `--dir <name>` is a generic mechanism that always resolves inside `INSERTS_BASE`, and it always passes a bare name (never an absolute path) to the external `update-inserts-from-server` CLI, so it has no way to reach `~/.smaht-im/branches/`. Its own documented usage (see README) only ever uses plain, non-`temp-local-inserts`-prefixed names like `donor-only`, so real collision risk is low — but if someone runs `im.py --dir temp-local-inserts-<slug>` against a name that imc thinks lives elsewhere, `im.py` will silently create/write it in the old location instead. Don't "fix" this by changing `im.py` — that was a deliberate scope decision, not an oversight.

If you ever need to migrate again (e.g. a fresh machine with stray branches still sitting in the old location), see `scripts/migrate-branches.js` — safe to re-run, uses atomic same-filesystem rename with a copy+verify+delete fallback for cross-device moves.

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

## Tests

```bash
npm test          # JS: node's built-in test runner against src/core.js
npm run test:py   # Python: im.py's pure helpers (needs the smaht311 env's click/requests)
npm run test:all  # both
```

Covers `src/core.js` (the pure data layer), `im.py`'s pure helpers (name conversion, manifest read/write, insert-dir reading), and, as of `test/panels.folder-highlight.test.js`, component-rendering tests for `Panels.jsx` (currently just `FolderPanel`'s focus highlighting; the pattern below extends to other components). Does not cover `App.jsx`/`Modals.jsx` (no rendering tests exist for those yet) or im.py's Click commands (`status`/`pull`/`repull`/`coverage`/`workspaces`).

**Isolation, and why it matters here specifically:** both `core.js` and `im.py` resolve their working paths (`INSERTS_BASE`, `BRANCHES_BASE`, the manifest dir, the keys file) from `SMAHT_REPO_ROOT`/`HOME` once, at import time, not per call. Every test file points those at a fresh temp directory *before* importing the module under test (`test/helpers/env.js` on the JS side; the top of `test/test_im.py` on the Python side), so the suite never reads or writes a real smaht-portal checkout or a real `~/.smaht-im`, only ever throwaway temp dirs it creates and owns. This isn't just tidiness: the whole point is that real pulled data may be protected (see "Data safety" above), so tests must never be able to touch it, even by accident.

**If you add a new JS test file:** set env vars via `useTempEnv()` *before* importing `core.js`. A static `import` at the top of a file is hoisted and runs before any other code in that file, env vars set below it would be too late, so use a dynamic `const core = await import('../src/core.js')` placed after `useTempEnv()`, never a static import. `node --test` runs each test file as its own process (verified empirically, not just assumed), which is what makes per-file env vars safe here; don't assume that'd still hold if two test files' code ever ran in the same process.

**Sync-mechanics tests** (`test/core.sync-mechanics.test.js`) exercise `syncFolderAsync`/`pullBatchIntoFolderAsync` against a fake `update-inserts-from-server` (`test/fixtures/bin/`, put at the front of `PATH` by `useTempEnv()`) instead of the real CLI tool, so they never make a network call, never need real portal credentials, and never risk touching real data.

**Component-rendering tests** (e.g. `test/panels.folder-highlight.test.js`) use `ink-testing-library` (devDependency), which needs two things `core.js`'s tests don't:

- **A JSX transform.** Node's own module loader has no idea what to do with `.jsx` syntax; this project only ever transforms it via esbuild, at build time, into `dist/imc.js`. `test/helpers/compileJsx.js`'s `importJsx(entryPath)` runs the exact same esbuild flags `package.json`'s `build` script uses (`--bundle --packages=external --platform=node --format=esm`) against a single component file, writes the result under `test/.compiled/` (gitignored, fixed filename per source file so repeated runs overwrite instead of accumulating), and dynamically imports that. It has to land under the project root, not `os.tmpdir()`, since `packages: 'external'` leaves `react`/`ink` as real imports the compiled file resolves via `node_modules` found by walking up from *its own* location, that resolution silently fails from anywhere outside this project.
- **`FORCE_COLOR=1`, set before ink/react/ink-testing-library are first imported** (same dynamic-import-after-setting-the-env-var pattern `useTempEnv()` already uses for `HOME`/`SMAHT_REPO_ROOT`, and for the same reason: chalk's color-support detection runs once, at its own import time). Outside a real TTY, chalk normally suppresses color output entirely, which would make asserting on "is this green" impossible. The actual ANSI codes to assert against were verified directly with a throwaway spike before writing the real tests, not guessed: green foreground is `\x1b[32m`, chalk's `"gray"` (= ansi `"bright black"`) is `\x1b[90m`, `dimColor` is `\x1b[2m`. Don't assume named colors map to the codes you'd expect without checking; `"gray"` in particular is not `\x1b[37m` (that's literal white).

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
    // specific keys to confirm. For a plain yes/no-style confirmation,
    // `key.return` must be accepted alongside whichever letter (e.g. `y`)
    // triggers onConfirm, not as a replacement for it. DeleteModal originally
    // only took `y`, inconsistent with SyncFolderModal/SyncItemModal already
    // taking `key.return || input === 'y'`, fixed to match, since a user
    // has no way to guess which modals are the exception.
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

**Esc must always be `onCancel`, never a save/confirm action** — even for a modal that's a multi-step editing session rather than a single yes/no prompt. `KeybindingsModal` used to route `key.escape` to `onSave(local)` (no true cancel existed), which meant a session with a stale in-memory copy of `bindings` (e.g. left open while the file changed some other way) would silently clobber the newer file contents on close. Fixed by giving it a dedicated `s` = save-and-close, matching every other modal's `Esc` = cancel.
- Pass `onConfirm={handleMyAction} onCancel={() => setModal(null)}`

## core.js conventions

- All exports are plain functions — no classes, no state.
- All I/O is synchronous (`fs.readFileSync`, `fs.cpSync`, `fs.rmSync`).
- Every write function validates that its target name starts with `INSERT_PREFIX` before touching the filesystem. Do not skip this.
- Every folder-path lookup goes through the private `resolveFolderPath(name)` helper — never hand-roll `path.join(INSERTS_BASE, someName)` again. The rule is purely "is `name` the literal string `ACTIVE_FOLDER`?", not "is this the currently-loaded folder?" — a branch that happens to be loaded right now still resolves to `BRANCHES_BASE`; only the bare working-copy directory resolves to `INSERTS_BASE`.
- `loadFolder(name)` returns `null` if the directory doesn't exist — callers must handle null.
- `loadAllFolders()` always puts the active folder (`temp-local-inserts`) first.
- **A branch must never have zero `.json` files.** `createFolder(name, null)` (the "(none)" base option in `NewFolderModal`, pre-selected by the `N` keybinding — `n` defaults to whichever folder is highlighted in FolderPanel, which is usually not what you want when you specifically mean to start empty) writes one placeholder `donor.json: []` rather than an empty directory — confirmed by reading `snovault/loadxl.py`'s `load_local_data()`: it only checks whether `temp-local-inserts` has *any* `.json` file at all; find zero, and the portal silently falls back to loading `demo_inserts`/the real `inserts/` fixtures instead of an actually-empty working copy. Which type the placeholder is doesn't matter (types are discovered dynamically, and an empty list is a no-op either way) — this is the reason `temp-local-inserts-empty` (a folder with ~29 empty-array type files) existed as a manual template before this fix; a single placeholder file does the same job, so that folder is now redundant, not required.
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
rowH          = contentHeight - overviewH(8) - logH(6)
```

The right column is Overview (fixed height) → a `Types | Items` row (both get `rowH`) → the error log (fixed height). Types and Items sit side by side rather than stacked: `TypePanel` sizes its own width to its content (longest `name.json [count]` row, clamped 24-44 cols) so it no longer stretches to fill the row the way a bare `flexGrow` box would; `ItemsPanel` takes `flexGrow={1}` to fill whatever width is left. This also matches the `h`/`l` focus-cycle order (Folders → Types → Items), which is left-to-right.

`OverviewPanel` (`Panels.jsx`) stacks one label/value row per fact (`Last pulled`, `Items`, `Env(s)`, `Query`) via a shared `OverviewRow` helper that pads labels to a fixed width for column alignment, rather than cramming them side by side, plus a conditional hint line below them — `overviewH` accounts for the title row + 4 data rows + 1 hint row + 2 border rows. `Env(s)` comes from `getFolderEnvs(folderName)` in `core.js`, which reads the manifest (`loadBranchMeta`) and collects distinct `env` values across per-type entries (newest `last_pulled` first) falling back to `__tracking__.env` if no per-type entry has one — a folder can genuinely show multiple envs if its data came from more than one over time. `Query` is the folder's effective tracking query via the new `getFolderTracking(folderName)` in `core.js` (extracted from what were previously duplicate inline IIFEs in `App.jsx`/`syncFolderAsync` — same "first per-type entry, else `__tracking__`" logic). The hint row renders `This folder is missing N inserts available on the live portal — press <sync key> to pull them down` whenever the folder's cached remote check has `behind > 0`, and is blank otherwise — reserved as a fixed row rather than conditionally resizing the panel, consistent with this app's fixed-height layout model. It deliberately only reads `behind`, never `ahead` — see the "Indicator column" note above on why `ahead` isn't trustworthy enough to surface.

Each panel subtracts its border rows from height before computing `visibleWindow`. If you add a new row to a panel's header, reduce `innerHeight` by 1 to compensate.

## Panels: scrolling

`visibleWindow(items, selectedIdx, maxRows)` in `Panels.jsx` returns a centered slice. It is pure and has no side effects. Do not replace it with a stateful scroll offset — the current approach keeps scrolling automatic.

## Items panel columns

`ItemsPanel`'s header row and each item row are two independent `<Text>` strings built from the same `UUID_W`/`ID_W`/`TITLE_W`/`GAP` constants — they only stay visually aligned because every field width in one exactly matches the other. The header's leading `'    '` (4 spaces) exists specifically to match a row's `▶ `/`● ` cursor+select markers (2 + 2 = 4 columns) — dropping to a 2-space header lead-in (as it briefly was) shifts every header label 2 columns left of the values under it. If you add, remove, or resize a column, update the width constant once and both header and rows follow automatically; don't hand-edit padding in only one of the two.

The `Title` column is conditional — `hasDisplayTitle = items.some(i => itemTitle(i.data))` — shown only when at least one item in the *current type* actually has one, falling back to `—` per-row for items that don't. This mirrors the existing "conditional row" pattern used elsewhere (e.g. Overview's missing-inserts hint) rather than always reserving space for a column that's usually empty for a given type. `itemTitle()` checks `display_title` first, then `title`: `display_title` is a *computed* property that only ever appears in live portal responses, never in raw stored inserts (which is why it looked empty for every local-only type before this), while `title` is a real persisted field some types define instead — Publication has `title` but no stored `display_title`, for example.

Every `<Text>` in this panel sets `wrap="truncate-end"` — Ink's default is to wrap, not clip, when content is wider than its container. That matters here specifically because `ItemDetailPanel` opening/growing takes a fixed slice of width away from this panel's `flexGrow={1}`; without `wrap`, a squeezed row wraps onto a second terminal line instead of just losing its tail end, which reads far worse for a single logical row. The manual `padEnd`/`trunc` calls already handle the common case (enough room); `wrap="truncate-end"` is the safety net for whenever they don't.

## Item detail panel

`Enter`, while focused on the Items panel and an item is highlighted, toggles a collapsible JSON tree view (`ItemDetailPanel` in `Panels.jsx`) open in a third fixed-width column to the right of ItemsPanel, inside the same `flexDirection="row"` box as TypePanel/ItemsPanel — Yoga gives ItemsPanel's `flexGrow={1}` whatever width is left once TypePanel's and this panel's fixed widths are subtracted.

`Enter` and Tab/h/l here are hardcoded, not part of the `bindings` system — `captureKey()` in `keybindings.js` refuses to let Esc/Enter/Tab/arrows be captured for rebinding at all.

**Rendering — a real tree, not stringified text:** `flattenJson()` recursively walks `item.data` into one row per visual line: a collapsible object/array contributes an opening row (`▾ "key": {` expanded, or `▸ "key": { …N keys… }` collapsed, computed straight from `collapsed.has(path)` — no separate expanded-node bookkeeping) plus, when expanded, its children's rows and a closing-bracket row; a primitive contributes one row (`"key": "value"`, no trailing comma — dropped everywhere for readability, unlike real JSON). Each row carries `{text, color}` segments (`primitiveSegments()`/inline key coloring) so keys (cyan), strings (green), numbers (yellow), booleans (magenta), and null/punctuation (gray/white) render distinctly; `truncSegments()` hard-truncates a row's *total* rendered width across segment boundaries the same way `trunc()` truncates a plain string, so a long value doesn't blow out the fixed panel width.

**Fully controlled, like every other panel:** `detailCursor` (index into the flattened row list) and `detailCollapsed` (`Set` of node paths) both live in `App.jsx`; `ItemDetailPanel` only flattens/renders and reports intent via `onSelect`/`onCollapsedChange` — same "panels own nothing" shape as `folderIdx`/`typeIdx`/`itemIdx`. Both reset (`useEffect` keyed on `itemIdx`/`currentType?.name`) whenever the highlighted item changes, since one item's collapse state has nothing to do with another's; reopening the *same* item after closing does **not** reset them — only actually switching items does.

**Navigating into it — `focus` gains a fourth value, `'detail'`:** the Tab/h/l cycle is normally `['folders', 'types', 'items']`; while `viewDetail` is true it becomes `['folders', 'types', 'items', 'detail']`, computed fresh each keystroke rather than hardcoded, so Detail only ever joins the cycle while actually open. Inside the panel, `j`/`k`/arrows move `detailCursor` (guarded by `isFocused`, exactly like FolderPanel/TypePanel/ItemsPanel's own local nav), `Enter` **or** `Space` toggles collapse of the highlighted node (collapse-state mutation happens inside the panel — it already has to flatten the tree to render, so it computes the new `Set` and hands it up via `onCollapsedChange` rather than App.jsx duplicating the walk), and `c` collapses every collapsible node in the tree at once (a separate full walk of `item.data`, independent of current collapse state or scroll position). `Space` is otherwise the global `selectItem` binding (load a folder / toggle an item's multi-select, depending on `focus`), but that handler's own `focus === 'folders' | 'items'` branches simply don't match when `focus === 'detail'`, so it no-ops there and Space is free for the detail panel's own `useInput` to claim — no collision.

**A subtlety worth remembering if this code changes:** `detailCursor` is App state and can go stale the instant collapse/expand changes how many rows exist — e.g. `c` (collapse all) can shrink `rows` out from under whatever index was current mid-render. `ItemDetailPanel` clamps once per render (`clampedIdx = Math.min(selectedIdx, rows.length - 1)`) and then uses *only* `clampedIdx` for movement math, the Enter-toggle row lookup, and `visibleWindow` — never the raw `selectedIdx` prop. Reintroducing a raw `selectedIdx` read anywhere in this component reopens the exact bug this fixed: pressing Enter right after collapsing everything silently no-oped because `rows[selectedIdx]` pointed past the end of the now-1-row list.

**Auto-close, not a toggle-per-item:** a `useEffect` closes `viewDetail` the instant `focus` is neither `'items'` nor `'detail'` — covers every way focus can leave both (Tab, Shift+Tab, h, l, selecting a folder/type) without needing to remember to close it at each call site individually. `Esc` closes it explicitly too (checked before `Esc`'s existing "clear item selection" behavior, so closing the preview doesn't also blow away a multi-select in progress) and, since `Esc`/leaving via Tab-past-Items can be reached with focus already sitting on `'detail'`, also sets `focus` back to `'items'` — otherwise focus would be left pointing at a `'detail'` value no panel matches anymore, and j/k would go nowhere.

**Cursor-line highlight:** the highlighted row gets a faint `backgroundColor="#303030"` behind *only its actual text* — no trailing padding segment stretching it to the full inner width. Each segment keeps its own syntax color against that background rather than being flattened to one. This went through two rounds of toning down: a solid `color="black"` on green (unmistakable but fought the syntax coloring), then `backgroundColor="gray"` padded to full width (still too strong, and the padded fill was wide enough that it could spill onto a second terminal line — every segment needs `wrap="truncate-end"` for exactly this reason, a hard backstop rather than trusting `truncSegments`' width math alone). `"gray"` is chalk's `blackBright` alias, the ANSI palette's darkest non-black background option; `#303030` (a hex background, which Ink's `colorize()` passes straight to `chalk.bgHex()`) is deliberately darker than that palette offers — the one place in this codebase using a hex color instead of a named one, because "more subtle than gray" has no named equivalent.

**`z` — zoom to a full-screen modal:** `ItemDetailModal` (`Modals.jsx`) renders the *same* `ItemDetailPanel` component at a much larger size (`Math.min(140, termWidth - 8)` × `Math.max(10, termHeight - 6)`, same formula shape as `useLogLayout`), passing the identical `detailCursor`/`detailCollapsed` App state rather than component-local state — so scroll position and collapse state carry over exactly when zooming in or out, and opening/closing the modal never touches `viewDetail`/`focus` at all; it's a read-only overlay on top of whatever the side panel already had going. `z` works from either `'items'` or `'detail'` focus, as long as `viewDetail` is true (nothing to zoom into otherwise) — checked in the global handler, hardcoded like `Enter`/`c` rather than added to the `bindings` system. Inside the modal, `Esc` **or** `z` closes it (`ItemDetailModal`'s own `useInput`); `ItemDetailPanel` takes a `inModal` prop purely to word its own hint line correctly (`z=full view` outside, `z/Esc=close` inside) since `z`'s meaning flips between the two contexts.

## Error log persistence

The in-app `errorLog` state (shown in the Log panel and the `L` modal) is capped at 50 in-memory entries and is lost on quit. `appendLog(message)` in `core.js` additionally writes every entry to `~/.smaht-im/imc.log`, one timestamped line per entry, trimmed to the last `LOG_LINES` (500) lines on every write — small enough (well under ~100 KB at typical entry length) to never need manual cleanup.

All app-side pushes to `errorLog` go through a single `pushLog(msg)` helper in `App.jsx` that updates state and calls `appendLog` together — do not call `setErrorLog` directly, or the on-disk log will silently miss entries.

Two modals view this, both in `Modals.jsx` sharing a `LogViewer`/`useLogLayout` pair so their scrolling and layout math can't drift apart:
- `L` → `ErrorLogModal` — the session-scoped `errorLog` state (≤50 entries, gone on quit).
- `F` → `FullLogModal` — calls `readLogFile()` fresh each time it opens, so it shows the actual on-disk file (≤500 lines, survives restarts). `App.jsx` only computes `fullLogLines` while `modal === 'fulllog'`, following the same inline-compute pattern as `diff` in the modal render block.

## Remote tracking

Each folder can be "tracked" against a portal environment. Staleness is detected via UUID-set comparison — NOT field-level change detection (no reliable `date_modified` equivalent; `last_modified` reflects reindexing, not data changes).

**Manifest sidecar** — `~/.smaht-im/{folderName}.json` (written by `im.py`, extended by imc):
- Per-type entries: `{ TypeName: { env, query, count, last_pulled } }` — written by `im.py`
- `__tracking__` key: `{ env, query }` — written by imc when user sets a manual query via `t`, **and automatically by `handleCreateFolder` in `App.jsx`** when a new folder is created with exactly one query — that query doubles as its tracking query, so `f`/the staleness indicator work immediately without a separate `t` step. `NewFolderModal` can seed a folder from several queries at once (chip-input, same idea as `PullMoreModal` — see below); when there's more than one, no single query could stand in for "what `f` re-runs", so `__tracking__` is deliberately left unset in that case, same as any other query-less folder. Only written after `syncWorkingCopyToFolder` succeeds (a failed copy leaves no manifest, matching the folder's actual state); `triggerRemoteCheck` runs right after so the indicator doesn't sit on `?` waiting for the next background pass.
- `__remote_cache__` key: `{ checked_at, behind, ahead, error }` — TTL 5 min, written by imc

**Credentials** — `~/.smaht-keys.json`: `{ env: { key, secret, server } }`. `server` is the full base URL. The `loadEnvAuth(env)` helper reads this.

**Two-level sync**:
- **Folder sync** (`f` in FolderPanel): re-runs `update-inserts-from-server --dest <folderPath>` using the stored query. Never touches the working copy. Streams live output and supports cancellation — see "Pull/sync mechanics" below.
- **Item sync** (`f` in ItemsPanel): `GET /search/?uuid={uuid}&limit=1` replaces one entry in the folder's `.json`. Works on any branch folder. A single fetch, not a spawned process — none of the streaming/cancel machinery below applies to it.

**Indicator column** in FolderPanel (rightmost, before age):
- `~` = checking / no result yet
- `?` = no manifest and no `__tracking__` set
- `✓` = nothing new on the portal (`behind === 0`)
- `↓N` = N items on the portal not present locally (yellow)
- `!` = fetch error (red)

`checkRemoteAsync` also computes `ahead` (local UUIDs not returned by the tracking query) and stores it in `__remote_cache__`, but `remoteIndicator` (`Panels.jsx`) deliberately never displays it. A folder's tracking query is often narrower than everything it locally holds — e.g. type-filtered while transitively-pulled linked types (`SubmissionCenter`, etc.) sit alongside — so `ahead` routinely counts items that could never match the query, not genuinely stale ones. Surfacing it reads as "42 things are wrong" when the real number is often much smaller or zero.

**Key bindings** (configurable via keybindings system):
- `f` = sync (context-aware: folder or item)
- `t` = set tracking query (opens `SetQueryModal`)
- `A` = pull more (opens `PullMoreModal`) — adds items via a one-off query without touching the stored tracking query, see below

**When NOT to use item-level sync**: after a folder-level sync has run, all items are refreshed. Item sync is for targeted updates when you know a specific item changed.

**Pulling more without changing tracking** — `A` opens `PullMoreModal`, a chip-input-style query builder: type a query, Enter adds it to the batch and clears the field; Enter again on an empty field runs everything queued, in order; Backspace on an empty field removes the last queued query. All queries in one batch share one env. Submitting calls `pullBatchIntoFolderAsync` in `core.js`, which runs each query sequentially against the same folder (must be sequential — they write the same JSON files, so parallel would race), **stopping at the first failure** rather than skipping past it, and computes one before/after diff across the *whole* batch rather than one per query. `App.jsx`'s `handlePullMore` injects a `── Query i/N: <query> ──` separator line into the live output (via the same `onPullLine` used everywhere else) so `PullLogModal`/the compact spinner show which query is currently running — no new UI plumbing needed for that.

`update-inserts-from-server` merges into what's already on disk rather than replacing it (see "Pull/sync mechanics" below for exactly how — it also transitively follows links, so pulling one item type can pull several), so this path is genuinely additive: the folder's stored tracking query is never touched, only read (to show as context in the modal).

**Deliberately no backup** — unlike every other write path in this codebase, `pullBatchIntoFolderAsync` does *not* call `backupFolder` first. It's a frequent, purely-additive action; backing up on every call would flood the 10-per-folder cap with routine "add more" snapshots that crowd out more meaningful history (a bad `f` sync, a risky restore). If you're tempted to add a backup call here, don't — that was a deliberate choice, not an oversight, and `f`/restore's backups remain fully intact regardless.

**Seeding a new folder from several queries** — `NewFolderModal` (`n`/`N`) uses the same chip-input UX as `PullMoreModal` for its Query field: type a query, Enter queues it and clears the field; Enter again on an empty field creates the folder (with however many queries got queued, including zero); Backspace on an empty field removes the last queued one. `handleCreateFolder` in `App.jsx` runs the queued batch via `pullBatchIntoFolderAsync(ACTIVE_FOLDER, env, queries, ...)` — passing `ACTIVE_FOLDER` as the "folder name" targets the working copy (via `resolveFolderPath`), matching what this path always did (switch to the new folder first, pull into the now-active working copy, then `syncWorkingCopyToFolder` the result back into the new folder) — it just reuses the existing sequential-batch runner instead of a one-off single-query call. `pullFolderAsync`, the old single-query-only wrapper this replaced, has been removed — nothing else called it.

## Pull/sync mechanics

`syncFolderAsync` (folder resync) and `pullBatchIntoFolderAsync` (additive pull batch — both `A` and new-folder-with-queries) delegate to a single private `spawnUpdateInsertsAsync({ env, query, dest }, onLine, onDone)` in `core.js` — don't reimplement the spawn/stream/confirm logic in a new caller, use this helper.

**What the underlying tool (`snovault.commands.update_inserts_from_server`) actually does with `--search`** — worth knowing before adding any new caller: it doesn't just save search results. It (1) resolves the search to a UUID set, (2) **transitively follows every link** in each fetched item's properties (any field value that looks like a UUID) and fetches those too, recursively, until the graph closes — so pulling one Donor can also pull its linked Tissue/Sample/SubmissionCenter/etc., not just the searched type, (3) **merges** with whatever's already in the destination folder rather than replacing it (portal properties win on conflicting UUIDs, local-only extra fields survive unless `--refresh` is passed), (4) silently drops anything whose UUID already exists in `master-inserts` (identical or conflicting — not surfaced anywhere in imc today). Auth reads `~/.smaht-keys.json` — the same file `loadEnvAuth` already uses — via `dcicutils.creds_utils.SMaHTKeyManager`, overridable with a `SMAHT_KEYS_FILE` env var if that's ever needed.

**Why it auto-confirms stdin:** `update-inserts-from-server` prints an interactive `Continue? (y/n)` prompt whenever `--dest`'s basename isn't in its own hardcoded whitelist (`inserts`, `master-inserts`, `perf-testing`, `workbook-inserts`, `temp-local-inserts`, `deploy-inserts`) — which is *every* real `temp-local-inserts-<slug>` branch folder. Left unanswered (the previous behavior), the spawned process hangs forever with no error — confirmed by direct reproduction. The helper writes `"y\n"` to `child.stdin` immediately after spawning; imc's destinations are always programmatic and pre-validated, so auto-confirming is correct here, not just expedient.

**Signature:** `onLine(line)` streams output as it arrives; `onDone({ success, killed, code, signal })`. Returns `{ cmd, kill() }` — `kill()` sends `SIGTERM` once, safe to call again. `syncFolderAsync`/`pullBatchIntoFolderAsync` wrap this in their own `onDone` shape (see their docstrings) and both return `{ cmd, kill }` (`pullBatchIntoFolderAsync` just `{ kill }`, since a batch has no single `cmd` string) too.

**App.jsx state:** a single `pullState` object (`{ kind, target, cmd, kill, lastLine, done, success, killed }`) replaces what used to be a bare `pulling` string — only one pull/sync runs at a time. The full output buffer lives in a separate `pullLinesRef` (not in state, to avoid an array copy on every throttled render); `startPull`/`onPullLine`/`finishPull` in `App.jsx` are the only places that should touch either. `ErrorLogPanel`/`ErrorLogModal` still take a plain string — pass `pullingLine` (derived: `pullState && !pullState.done ? pullState.lastLine : null`), not `pullState` itself.

**Full output + cancel** — `p` (`viewPull`) opens `PullLogModal` (`Modals.jsx`, reuses the same private `LogViewer`/`useLogLayout` as `ErrorLogModal`/`FullLogModal`) showing the complete scrollable output of the current/last pull; `x` (`cancelPull`) kills an in-flight one, from the main view or from inside the modal. **Footer note:** these two entries are only added to `Footer`'s `actions` array while `pulling` is true (not just dimmed via `active` — actually absent) — the footer already wraps at common widths with its ~17 baseline entries (see "Layout math"), so don't make them permanent for a feature that only matters during the small fraction of time a pull is running.

**Keeping the working copy in sync when the loaded folder is the sync target** — `syncFolderAsync`/`pullBatchIntoFolderAsync`/`syncItemAsync`/`restoreBackup`/`moveItems` all write to a named folder via `resolveFolderPath(folderName)`, never to `temp-local-inserts` directly. If `folderName` happens to be the currently loaded folder (a branch, not the literal `ACTIVE_FOLDER`), that write left the working copy holding stale pre-write data — and the very next `loadAllFolders()` treated that mismatch as an external edit, auto-snapshotting the *stale* data into a spurious new folder and reassigning `HEAD` to it (confirmed by reproducing: pressing `f` to sync the loaded folder produced a decoy folder containing the pre-sync contents). Fixed with a private `refreshWorkingCopyIfActive(folderName)` in `core.js` (right after `workingCopyMatchesFolder`) that mirrors the folder's on-disk content into the working copy whenever it's a no-op check away from being live — called at the end of every one of those five write paths, including the partial-failure branch of `pullBatchIntoFolderAsync` (earlier queries in a batch may have already merged data before a later one failed).

## Sync results & backup history

Both sync paths answer "what did that just do?" and give a way back out, since UUID-set tracking can't tell you an item's *contents* changed underneath you.

**What changed** — `syncFolderAsync`/`syncItemAsync` in `core.js` take a 3rd callback arg (`diff`/`changes`) computed via shared helpers in the diff section: `diffFolderObjects(before, after)` (type-level added/removed, same shape `computeDiff` already used by the `d` Diff feature) for folder sync, `diffItemFields(before, after)` (shallow field-level before/after) for item sync.
- Folder sync with real changes opens `DiffModal` (reused as-is) labeled `(before)`/`(after)` instead of two folder names — see `modal === 'sync-result'` in `App.jsx`.
- Item sync with real changes opens `ItemSyncResultModal` (`Modals.jsx`) — one row per changed field, red `-before` / green `+after`.
- No changes on either path → a plain notify, no modal (an empty diff table isn't useful).

**Backup history** — `backupFolder(folderName, reason)` in `core.js` runs before every write in both sync paths (and before every restore), copying the folder's current JSON files to `~/.smaht-im/backups/{folderName}/{id}/` — **outside `INSERTS_BASE`**, so it never needs the `INSERT_PREFIX` write-guard (same reasoning as the anonymized-export directory). Capped at `MAX_BACKUPS_PER_FOLDER` (10) per folder, pruned oldest-first on every backup.

**Restore** — `H` (`viewHistory`) opens `HistoryModal`, context-aware on the highlighted folder in FolderPanel. `listBackups(folderName)` lists them newest-first; Enter/`r` calls `restoreBackup(backup.target, backup.id)`, which itself calls `backupFolder` first — a restore is never a dead end.

**Active-folder special case:** a failed/cancelled create-and-pull backs up `ACTIVE_FOLDER` (the raw `temp-local-inserts` working copy), not the new folder's own name — the new folder is never populated during the pull, only the working copy is, and it's about to be overwritten by the fallback `switchFolder`. But `ACTIVE_FOLDER` never appears as a row in FolderPanel (it's filtered out of `loadAllFolders()`), so a backup keyed under it would otherwise be unreachable. `App.jsx`'s `historyBackups` computation merges `listBackups(currentFolder.name)` with `listBackups(ACTIVE_FOLDER)` whenever `currentFolder.isActive`, tagging each entry with a `target` field so `HistoryModal` labels the working-copy ones `[working copy]` and `handleRestoreBackup` routes the restore to the right directory. If you add another code path that backs up `ACTIVE_FOLDER` directly, it needs this same merge to be reachable — don't assume `listBackups(currentFolder.name)` alone is complete for the active row.

## Anonymized export

Inserts contain real donor/sample/tissue records — not safe to share as-is. `anonymizeFolder(sourceName, opts)` in `core.js` writes a de-identified copy of a folder to `~/smaht-im-exports/` (never into `INSERTS_BASE` — it's export tooling, not a working branch, so it doesn't need the `INSERT_PREFIX` write guard). It remaps every UUID consistently across all type files (referential integrity survives), scrubs/fakes fields by name (`ANONYMIZE_DEFAULT_POLICY`), jitters dates, and shuffles quasi-identifier columns across records of the same type (skipped in favor of redaction when a group has fewer than `minGroupSizeForShuffle` records — permuting a handful of values isn't real protection).

Two entry points share this one implementation — keep them that way rather than letting them drift:
- imc: `e` keybinding in the Folders panel → `AnonymizeModal` → `handleAnonymize` in `App.jsx`. Only ever fires on that explicit keypress; nothing else calls it.
- CLI: `scripts/anonymize-inserts.js`, a thin argv-parsing wrapper around the same `anonymizeFolder()`.

This is a generic heuristic, not a compliance decision — see the README's "Sharing inserts data safely" section before changing the default policy or telling someone it's safe to send something.

## Copy to clipboard

`y`, context-aware like `f`/`sync`: in the Folders panel, copies every item across all types in the highlighted folder — or, if any folders are multi-selected (see "Range select" below), every item across *all* of them merged together; in the Types panel, copies every item in the highlighted type; in the Items panel, copies the selected items (falling back to just the highlighted one if nothing's selected via `Space`). Any other focus (the item detail panel) just notifies "Select a folder, type, or item(s) to copy" — that's the only one out of scope for this action.

Folder copy shapes the JSON as `{ typeName: [...items] }`, matching the on-disk file layout exactly (one key per type file, each an array of that type's raw records) — not a flat list, so the copied text stays recognizable as "the folder" if pasted into a file. Multiple selected folders merge into that same shape type-by-type (a second folder's `donor.json` items append to the first's array under the same `"donor"` key) rather than nesting per-folder — copying 3 folders looks exactly like copying 1, just with more per type. Type copy is a **plain array**, not wrapped in `{ typeName: [...] }` — it's already scoped to one type, so the wrapper folder-copy needs to tell types apart would be redundant; this also matches what's actually in `donor.json` on disk (itself just an array), same "match the on-disk shape" reasoning folder-copy already follows, just one level down. Item copy unwraps to a bare object when there's exactly one item (pasting one thing should give you that thing, not a one-element array around it), and an array only when there are several — type copy deliberately does **not** get this same unwrap for a single-item type, since "match the file" and "give me exactly what I selected" are different goals answering to different callers. All three read the same `data` field every item already carries (`{ uuid, displayId, status, data }` — see `loadFolder` in `core.js`), so this needs no extra core.js call beyond the clipboard write itself; `currentFolder`/`currentType`/`currentItems`/`folders` in `App.jsx` already hold full item data, no re-read from disk.

`copyToClipboard(text)` in `core.js` shells out to `pbcopy` via `execFileSync` — macOS-only, deliberately: this tool has no other supported platform (see "What not to change without good reason"), so a cross-platform clipboard library would be dead weight for every other user. Throws if `pbcopy` isn't on `PATH`; the caller catches and `notify`s rather than crashing.

**Unlike anonymized export, this is raw data, unscrubbed** — copying is presumed to be for the user's own immediate local use (pasting into a scratch file, a REPL, a `jq` pipe), not for sharing. If that assumption ever stops holding — e.g. someone wants a "copy to send to someone else" action — that's an anonymized-export use case, not this one; route it through `anonymizeFolder` instead of adding a scrub step here.

## Manual edit in $EDITOR

`E`, available from the Types panel, the Items panel, and the item JSON detail view (side panel or full-screen `z` modal, both render the same `ItemDetailPanel` and both forward `E` to the same handler via an `onEdit` prop): opens the highlighted type's JSON file directly in the user's editor (`$VISUAL`, then `$EDITOR`, falling back to `vi`), for hand-edits the app has no dedicated UI for. Needs `currentType`, so it's out of scope from Folders. The motivating case: an insert references another by UUID and the referenced item needs to appear earlier in the same array (e.g. for a loader that processes a file in order), reordering objects within one file is exactly the kind of edit a real editor does trivially, and this app has no reason to reinvent that as a bespoke widget.

Triggering it from the item detail view closes that view first (`setViewDetail(false)`, `setFocus('items')`, folded into `handleEditTypeFile` itself so it's a no-op when entering from Types/Items directly). A hand-edit can reorder or remove items, so whatever `detailCursor`/`itemIdx` pointed at before may no longer mean the same thing, and reordering is the literal use case this feature exists for. From the full-screen modal specifically, the calling code closes the modal (`setModal(null)`) and calls the handler in the same tick; that's safe even though `spawnSync` blocks synchronously right after, because the "modal closed" state and the post-edit `refresh()` both apply together on the next paint, the intermediate frame is never actually rendered to the terminal.

`editTypeFile(folderName, typeName)` in `core.js` does the real work; the `App.jsx` handler (`handleEditTypeFile`) is a thin wrapper (try/catch to `notify`, always `refresh()` in a `finally`). Guarded in the global `useInput` handler against `isPulling`, spawning a blocking child while an async pull's own child process is mid-flight would just delay that pull's stdout/stderr callbacks until the editor exits (nothing breaks, but it's a confusing thing to have happen at the same time, so it's refused outright).

**Why this needed a real core.js function, not just "shell out and hope":**

- **Backs the folder up first**, same as every other write path (`backupFolder` before touching anything). A hand-edit with a real editor is if anything *more* likely to introduce a mistake than any of this app's own structured writes, so this is not a place to skip that convention.
- **Suspends the TUI properly.** Ink holds stdin in raw mode and keeps the alt-screen buffer active for its own rendering; both need to be handed back to the editor cleanly. Raw mode is straightforward (`process.stdin.setRawMode(false)` before spawning, back to `true` after). Alt-screen is the one worth remembering if this code changes: it's a single on/off flag, not a stack, so if imc's alt-screen were left "on" while the editor ran, the editor's *own* alt-screen enter/exit (e.g. vim's `smcup`/`rmcup`) would exit back to the **primary** screen when it quits, not back to imc's, leaving the terminal showing whatever was there before imc started, not imc's UI. Fixed by explicitly exiting alt-screen before `spawnSync` and re-entering it after, mirroring the exact escape sequences `index.jsx` uses at startup (`\x1b[?1049h`/`\x1b[?1049l`), so the editor gets a normal primary-screen terminal entirely to itself.
- **Validates the result is a JSON array before treating it as a normal edit.** `readJson`-style silent-failure-to-empty-array (like `loadFolder` does elsewhere) would be actively harmful here specifically, since it could make a bad hand-edit look like "this type now has 0 items" instead of surfacing that something's wrong. Invalid JSON or a non-array is reported back to the caller (`{ edited: false, error }`) rather than thrown, and the file is left exactly as the editor wrote it either way, never auto-reverted, since the user may still be mid-edit across multiple editor sessions.
- **Mirrors the edit into the working copy via `refreshWorkingCopyIfActive(folderName)`**, the same private helper `syncFolderAsync`/`pullBatchIntoFolderAsync`/`syncItemAsync`/`restoreBackup`/`moveItems` already call for exactly this reason (see "Keeping the working copy in sync when the loaded folder is the sync target" above). This is the part that's easy to get wrong by omission: without it, hand-editing the *currently loaded* folder's file leaves the working copy holding stale pre-edit data, and the very next `loadAllFolders()` call reads that mismatch as "someone changed the working copy externally" and auto-snapshots the stale data into a spurious new folder, reassigning HEAD to it, silently discarding the very edit the user just made from view (the data isn't lost, it's sitting in the new snapshot, but it looks like the edit vanished). This is precisely the behavior that prompted building this feature in the first place, rather than just telling people to edit the file directly with a text editor.

## Range select

`v`, context-aware for Folders and Items, both driven by the same `rangeAnchor` (`App.jsx`, a single nullable index — meaningful only relative to whichever panel was focused when it was set): first press marks the current row and selects it (immediate visible feedback that something happened); second press, anywhere else in the list in either direction, selects every row between the anchor and there (`Math.min`/`Math.max`, so direction doesn't matter) and clears the anchor so the *next* `v` starts a fresh range instead of extending this one indefinitely. Folders adds to `selectedFolderNames` (a `Set`, new state — see below); Items adds to the existing `selectedUuids`. Both are unions with whatever was already selected, not replacements — an existing `Space`-toggled item elsewhere in the list survives a later range fill.

A `useEffect` clears `rangeAnchor` on any `focus` change — marking row 3 in Folders and then tabbing to Items must not let a later `v` there silently pair with a Folders-panel index it has no relationship to. This mirrors `viewDetail`'s own focus-change cleanup right above it in `App.jsx`.

**Folders gained a selection concept it never had before.** `FolderPanel` already used a variable named `isSelected` to mean "is this the cursor row" (there was no multi-select to distinguish it from) — renamed to `isCursor` when adding the real thing, `isMultiSelected` (`selectedNames?.has(folder.name)`), with its own `✓` marker column (yellow, same convention as ItemsPanel's selected-item dot) between the existing cursor `▶` and active `●` markers. `Space` in the Folders panel still means "load this folder" (unchanged, and unavailable to double as a per-row toggle the way it does in Items) — `v` is the *only* way to multi-select folders; there's no ItemsPanel-style "toggle one at a time" for them, only marking a range (a range of one row is a valid way to select just that one folder, if that's all you need).

`Esc` clears `selectedFolderNames` and `rangeAnchor` unconditionally alongside its existing selection-clearing behavior — including on the early-return branch that closes the item detail view instead of clearing `selectedUuids`, since folder selection has no relationship to that branch's "don't blow away an in-progress item multi-select" reasoning.

## Collapsible Folders panel

`foldersCollapsed` (`App.jsx` state) shrinks `FolderPanel` from its normal dynamic width down to a much narrower strip (see iteration 4 below for exactly how that width is computed now), no list, no navigation, freeing that width for Types/Items. This came from direct user feedback (not a design guess), with explicit rules from that conversation worth preserving exactly:

- **Collapses automatically the moment focus leaves Folders**, and only then, a `useEffect` keyed on `focus` (`if (focus !== 'folders') setFoldersCollapsed(true)`), placed right alongside the existing `viewDetail`/`rangeAnchor` focus-change effects. It deliberately does **not** collapse on loading a folder (`a`/`Space`) while still focused there, loading and leaving are different actions, and only leaving should trigger it.
- **Never auto-expands just by tabbing back to Folders.** The same effect's condition (`focus !== 'folders'`) is false when focus arrives back on Folders, so it's a no-op there on purpose, re-expanding needs one of the two explicit actions below. Getting this wrong (e.g. expanding whenever `focus === 'folders'`) would fight the collapse effect and the panel would just flash open every time focus cycles through.
- **Two ways to expand, both explicit:** `Enter` while focus is already on Folders and it's collapsed (checked before the existing `key.return && focus === 'items'` block, since they guard different `focus` values and can't collide), and the dedicated `toggleFolders` binding (`o`) from anywhere, which also does `setFocus('folders')` when it's the expanding press specifically (not the collapsing one), so it doubles as a "jump to and reveal Folders" shortcut from deep in Items/Types. Creating a folder (`handleCreateFolder`, right after `createFolder()` succeeds, before the pull branch) also force-expands it unconditionally, on the reasoning that a folder that just started existing needs to actually be visible to navigate to, regardless of whatever a subsequent pull does.

`FolderPanel`'s own `useInput` (j/k navigation) is gated with `isActive: isFocused && !collapsed` in addition to the existing `isFocused` check, so collapsed-and-focused doesn't silently move a selection nobody can see.

**What the collapsed strip actually shows went through four iterations, all worth knowing about if this changes again:**

1. The loaded folder's name, one letter per row (a terminal can't rotate a glyph 90°, so this was the practical stand-in for "sideways text" that was asked for). Dropped on user feedback: "spelled out" one-letter-per-line read as noise rather than information at 3 columns wide.
2. The `toggleFolders` key itself, shown alongside an opt-in Nerd-Font icon path (`IMC_NERD_FONT`, gone as of iteration 3 below): first as inverted-color "keycap badge" text, refined to a plain dot after that badge was reported unreadable unless focused (gray-on-unfocused too close to the black text). Both the badge and the dot were dropped in favor of iteration 3. The rebindable-key-label handling from this iteration (`bindingLabel()` can hand back several characters) is what motivated the `^`-notation change below; that fix stuck even though this whole display approach didn't.
3. `FOLDER_ICON`, U+1F5C0 FOLDER: the same Unicode range as `DeleteModal`'s trash-can title icon and the keyboard glyph in `KeybindingsModal`'s title (all added in version 7.0 for old Wingdings/Webdings compatibility, all defaulting to plain TEXT presentation rather than forced full color, unlike a character introduced directly as part of the emoji standard, e.g. the more common FOLDER emoji U+1F4C1, which has no such legacy text form and always renders in fixed full color regardless of ANSI codes). Theoretically sound (it's exactly why the other two glyphs already render in their given colors elsewhere in this app), and no opt-in flag or font requirement needed since it's standard Unicode, not a custom font-patched code point. **Dropped anyway**, on direct user testing: this specific glyph didn't render (missing from their font), confirming the "residual risk" flagged when it was picked over the bracketed-keybinding alternative, in practice, not just in theory.
4. **Current:** the `toggleFolders` key itself, bracketed (e.g. `[o]`, `[^F]`), with the strip's width computed from the CURRENT binding's actual label length (`bindingLabel(bindings.toggleFolders)`, threaded down as a `toggleKey` prop) plus fixed padding (`FOLDERS_COLLAPSED_PAD_X`), not a hardcoded constant. This is the same key display idea iteration 2 already tried, but sized correctly this time instead of forced into a fixed-width box: since the box is sized to exactly fit whatever the current label is, there's no truncation or wrap handling needed at all, unlike iteration 2's fixed-width version did. Unfocused color matches `OverviewPanel`'s always-gray border + `dimColor` text rather than this panel's own usual white-on-unfocused, on direct user feedback that the brighter version drew too much attention for what's meant to be a quiet, out-of-the-way strip. Focus still highlights green, though, same as every other panel in this app (a first pass dropped `isFocused`-reactivity entirely to match `OverviewPanel` exactly, since `OverviewPanel` is never itself a focusable target; that went too far, since this strip still is one, so losing all focus feedback there was a real regression, not a feature).

**`bindingLabel()` (`keybindings.js`) uses `^` + the uppercased key for ctrl bindings** (`^A`, not `ctrl+a`), the conventional terminal notation for a control character, the same `^C`/`^D` shells themselves already print, and it's a global change, not scoped to this one panel: every ctrl binding displays this way everywhere now (footer, help screen, keybindings editor). Motivated by this collapsed strip specifically (iteration 2 above needed a rebound `ctrl+f`-style label to fit in 3 columns without wrapping), but kept as the app-wide convention since there's no reason for the two notations to coexist, and it's meaningfully more compact everywhere a key hint appears.

## Search

`/`, global (works regardless of `focus`, guarded only on at least one folder existing): opens `SearchModal`. Starts minimal on purpose, just the text input and its placeholder, no description text, no field label, so it reads at a glance as "type a uuid" rather than needing to be read. Once there's a query, a real result list (not just a count) takes over the rest of the modal, navigable with `↑`/`↓`, `Enter` jumps to whichever row is highlighted (folder/type/item cursor all set together, `focus` moved to `'items'`, `viewDetail` opened so the JSON is on screen immediately, not just highlighted in a list), `Esc` cancels. `findItemsByUuidAcrossFolders(folders, query)` in `core.js` does the actual matching, itself just a thin per-folder loop around the single-folder `findItemsByUuid(folder, query)`, both are synchronous, in-memory scans over already-loaded state (`App.jsx`'s own `folders`), no new disk read, no new core.js write path to reason about.

**Went through one scope revision already, worth knowing about if this changes again:** the first version searched only the currently loaded (active) folder, on the reasoning that `make deploy1`/`deploy2` load `temp-local-inserts`, i.e. whatever's active, so that's where a validation-failing uuid should live. Widened to every folder on direct user request ("make the search universal"): a uuid worth finding might be sitting in a branch that isn't loaded yet, and there was no good reason to force a folder switch first just to search it. Results still mark which ones are in the currently loaded folder (the same `●` convention `FolderPanel`'s own row list uses, next to the list's own `▶` cursor marker) precisely because that folder is usually still the one that matters most for the deploy1/deploy2 case, "universal" widened the search, it didn't remove the reason the active folder is worth calling out.

**Still deliberately scoped down in the ways that were never revised:**

- **uuid only, no other fields.** The motivating case only ever needed to answer "where's this uuid", not a general field search (submitted_id, accession, title, ...); that's a different, larger feature that wasn't asked for.
- **Substring match, not exact.** Forgiving of pasting a truncated uuid or typing just the first several characters; matches are case-insensitive. Results are capped at `SEARCH_MAX_VISIBLE` (8) with a "+N more, keep typing" line beyond that, rather than letting an early short query (matching almost everything) blow out the modal.
- **No validation feature here.** The actual motivation (a validation failure needs tracking down) is left for later, explicitly, per the user: this only gets you *to* the item quickly, it doesn't check anything about it. Don't read "search" as a first step toward validation and start bolting schema checks onto it without that being asked for separately.

Title icon is a literal `/`, not a decorative glyph, matching the keybinding itself rather than risking another Unicode-glyph-support gamble (see iteration 3 in "Collapsible Folders panel" above for exactly what that risk looks like when it doesn't pay off). Result rows use fixed-width columns via `padEnd`, each padded **2 columns wider** than the column actually needs, purely to hold the gap to the next column: JSX collapses whitespace-only text between `{expr}{expr}` pairs on separate lines down to nothing, so a gap relying on leftover padding alone would vanish silently whenever a folder name or type happened to exactly fill its column.

## How smaht-portal actually loads inserts (background)

Researched 2026-08-20 in `~/dbmi/smaht-portal`, prompted by the question "could inserts be served to the browser instead of via `make deploy1`/`deploy2`?" Recorded here so it doesn't need re-researching.

`make deploy1` runs snovault's `dev-servers --clear --init --load`: spins up local Postgres + Elasticsearch/OpenSearch + an nginx reverse proxy (single origin, `:8000` → app on `:6543`), creates ES mappings, then calls `load_local_data` (`snovault/loadxl.py`) — checks `tests/data/temp-local-inserts` first, falls back to other insert dirs, and loads whatever it finds through a real in-process Pyramid `TestApp` (`testapp.post_json`/`patch_json`): full schema validation, permissions, Postgres writes, then ES indexing queued. `make deploy2` is just `pserve development.ini` — serves whatever's already loaded, no insert-loading of its own.

**No browser-level mock-request shortcut exists for this.** Checked smaht-portal for MSW, nock, json-server, Cypress `cy.intercept`, webpack-dev-server proxy, `USE_MOCK`-style flags — none exist anywhere in the repo. The only "mock" hits are Python `unittest.mock` mocking of Pyramid `request` objects in backend unit tests (e.g. `test_authorization.py`) — unrelated to serving insert JSON as fake network responses. (This is almost certainly what was seen when searching for "mock requests" there.)

It also couldn't fully substitute even if built: smaht-portal is server-rendered. The initial HTML + embedded JSON props for any page are produced by a Node subprocess the Pyramid backend spawns (`src/encoded/static/server.js`) *before* anything reaches the browser. Browser-side fetch/XHR interception (service worker, browser extension, DevTools local overrides) could only affect later client-initiated calls (in-app search/browse re-fetches), not the first render of a page.

**PHI implication:** inserts contain real donor/sample/tissue data — the reason [Anonymized export](#anonymized-export) exists, and why smaht-portal's `.gitignore` excludes `temp-local-inserts*` from version control. Any browser-mocking pathway (service worker cache, an intercepting browser extension, a local mock server) would create a *new* copy/exposure surface for that data — Cache Storage, extension storage, or a proxy possibly bound beyond localhost — on top of what already sits in local Postgres/ES. A third-party intercepting extension in particular carries a supply-chain-style exposure risk the standard deploy pipeline doesn't have. Net: not worth building as a `deploy1`/`deploy2` replacement.

### Avoiding the Pyramid round trip on repeat loads

The full TestApp round trip (schema validation + Postgres write per item) is not the *only* option — `deploy1` just doesn't use the faster options that already exist in snovault:

- **The Postgres/ES datadir is not ephemeral.** `snovault/dev_servers.py` derives it from `development.ini`'s `sqlalchemy.url` `host=` param (smaht-portal's points at `/tmp/snovault/pgdata`, `esdata` alongside it) — a fixed path, only wiped when `--clear` is passed. `--clear`, `--init`, and `--load` are independently gated (`--init` runs `initdb`/creates ES mappings; the actual insert load only runs when **both** `--init` and `--load` are set). So running `dev-servers development.ini --app-name app` with none of those three flags starts Postgres+ES+nginx reattached to whatever's already on disk from the last load — no reload, no revalidation. `Base.metadata.create_all()` (gated by `create_tables` in the ini) is idempotent, so this is safe against an already-populated DB.
- **`make deploy1` doesn't expose this** — it hardcodes `--clear --init --load` (Makefile). A `deploy1-reattach: dev-servers development.ini --app-name app` target (no flags) would be a one-line addition to get "pay the load cost once, then just reattach" for as long as `/tmp/snovault/pgdata` survives. Caveats: (1) if the prior run was stopped via `make kill` (a blanket `pkill -f postgres`), a stale `postmaster.pid` can be left behind and needs deleting before Postgres will start again — `dev_servers.py` has a comment flagging exactly this; (2) skipping `--init` means ES reuses the old mapping, which can drift if a schema changed locally since the last real load.
- **Already free today, no changes needed:** `deploy1` (Postgres/ES/nginx) and `deploy2` (`pserve`, the app server) are already separate processes. Only `deploy1` pays the load cost — restarting just `deploy2` while leaving the `deploy1` terminal running never reloads anything.
- **No bulk/skip-validation loader exists in `loadxl.py`** — every loader funnels through `testapp.post_json`/`patch_json`, always full validation. The only "skip" flag (`validate_only`) is the opposite (validates but doesn't persist, for dry-runs). The pytest suite's own speed trick (`WorkbookCache` in smaht-portal's `conftest.py`, plus `snovault/tests/serverfixtures.py`'s savepoint-based rollback) loads fixtures once per pytest *process* on an ephemeral tmpdir Postgres, then rolls back per-test — same "pay once" idea, but scoped to a test run, not reusable for interactive `deploy1`.
- **No local DB-snapshot/restore workflow exists.** `docs/operations/restore_devtest_db.md` is AWS-RDS-snapshot machinery for the shared remote `smaht-devtest` environment (KMS/STS/Secrets Manager, swaps the whole RDS instance) — no pg_dump/pg_restore step, and nothing in it translates to a laptop without new tooling.

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
