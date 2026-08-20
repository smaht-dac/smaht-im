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
rowH          = contentHeight - overviewH(4) - logH(6)
```

The right column is Overview (fixed height) → a `Types | Items` row (both get `rowH`) → the error log (fixed height). Types and Items sit side by side rather than stacked: `TypePanel` sizes its own width to its content (longest `name.json [count]` row, clamped 24-44 cols) so it no longer stretches to fill the row the way a bare `flexGrow` box would; `ItemsPanel` takes `flexGrow={1}` to fill whatever width is left. This also matches the `h`/`l` focus-cycle order (Folders → Types → Items), which is left-to-right.

Each panel subtracts its border rows from height before computing `visibleWindow`. If you add a new row to a panel's header, reduce `innerHeight` by 1 to compensate.

## Panels: scrolling

`visibleWindow(items, selectedIdx, maxRows)` in `Panels.jsx` returns a centered slice. It is pure and has no side effects. Do not replace it with a stateful scroll offset — the current approach keeps scrolling automatic.

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
- `__tracking__` key: `{ env, query }` — written by imc when user sets a manual query via `t`, **and automatically by `handleCreateFolder` in `App.jsx`** when a new folder is created with a query — the query that populated it doubles as its tracking query, so `f`/the staleness indicator work immediately without a separate `t` step. Only written after `syncWorkingCopyToFolder` succeeds (a failed copy leaves no manifest, matching the folder's actual state); `triggerRemoteCheck` runs right after so the indicator doesn't sit on `?` waiting for the next background pass.
- `__remote_cache__` key: `{ checked_at, behind, ahead, error }` — TTL 5 min, written by imc

**Credentials** — `~/.smaht-keys.json`: `{ env: { key, secret, server } }`. `server` is the full base URL. The `loadEnvAuth(env)` helper reads this.

**Two-level sync**:
- **Folder sync** (`f` in FolderPanel): re-runs `update-inserts-from-server --dest <folderPath>` using the stored query. Never touches the working copy. Streams live output and supports cancellation — see "Pull/sync mechanics" below.
- **Item sync** (`f` in ItemsPanel): `GET /search/?uuid={uuid}&limit=1` replaces one entry in the folder's `.json`. Works on any branch folder. A single fetch, not a spawned process — none of the streaming/cancel machinery below applies to it.

**Indicator column** in FolderPanel (rightmost, before age):
- `~` = checking / no result yet
- `?` = no manifest and no `__tracking__` set
- `✓` = UUID sets match
- `↓N↑M` = N new in portal, M local not in portal (yellow)
- `!` = fetch error (red)

**Key bindings** (configurable via keybindings system):
- `f` = sync (context-aware: folder or item)
- `t` = set tracking query (opens `SetQueryModal`)
- `A` = pull more (opens `PullMoreModal`) — adds items via a one-off query without touching the stored tracking query, see below

**When NOT to use item-level sync**: after a folder-level sync has run, all items are refreshed. Item sync is for targeted updates when you know a specific item changed.

**Pulling more without changing tracking** — `A` opens `PullMoreModal`, a chip-input-style query builder: type a query, Enter adds it to the batch and clears the field; Enter again on an empty field runs everything queued, in order; Backspace on an empty field removes the last queued query. All queries in one batch share one env. Submitting calls `pullBatchIntoFolderAsync` in `core.js`, which runs each query sequentially against the same folder (must be sequential — they write the same JSON files, so parallel would race), **stopping at the first failure** rather than skipping past it, and computes one before/after diff across the *whole* batch rather than one per query. `App.jsx`'s `handlePullMore` injects a `── Query i/N: <query> ──` separator line into the live output (via the same `onPullLine` used everywhere else) so `PullLogModal`/the compact spinner show which query is currently running — no new UI plumbing needed for that.

`update-inserts-from-server` merges into what's already on disk rather than replacing it (see "Pull/sync mechanics" below for exactly how — it also transitively follows links, so pulling one item type can pull several), so this path is genuinely additive: the folder's stored tracking query is never touched, only read (to show as context in the modal).

**Deliberately no backup** — unlike every other write path in this codebase, `pullBatchIntoFolderAsync` does *not* call `backupFolder` first. It's a frequent, purely-additive action; backing up on every call would flood the 10-per-folder cap with routine "add more" snapshots that crowd out more meaningful history (a bad `f` sync, a risky restore). If you're tempted to add a backup call here, don't — that was a deliberate choice, not an oversight, and `f`/restore's backups remain fully intact regardless.

## Pull/sync mechanics

`pullFolderAsync` (new-folder-with-query), `syncFolderAsync` (folder resync), and `pullBatchIntoFolderAsync` (one-off additive pull batch, `A`) all delegate to a single private `spawnUpdateInsertsAsync({ env, query, dest }, onLine, onDone)` in `core.js` — don't reimplement the spawn/stream/confirm logic in a new caller, use this helper.

**What the underlying tool (`snovault.commands.update_inserts_from_server`) actually does with `--search`** — worth knowing before adding any new caller: it doesn't just save search results. It (1) resolves the search to a UUID set, (2) **transitively follows every link** in each fetched item's properties (any field value that looks like a UUID) and fetches those too, recursively, until the graph closes — so pulling one Donor can also pull its linked Tissue/Sample/SubmissionCenter/etc., not just the searched type, (3) **merges** with whatever's already in the destination folder rather than replacing it (portal properties win on conflicting UUIDs, local-only extra fields survive unless `--refresh` is passed), (4) silently drops anything whose UUID already exists in `master-inserts` (identical or conflicting — not surfaced anywhere in imc today). Auth reads `~/.smaht-keys.json` — the same file `loadEnvAuth` already uses — via `dcicutils.creds_utils.SMaHTKeyManager`, overridable with a `SMAHT_KEYS_FILE` env var if that's ever needed.

**Why it auto-confirms stdin:** `update-inserts-from-server` prints an interactive `Continue? (y/n)` prompt whenever `--dest`'s basename isn't in its own hardcoded whitelist (`inserts`, `master-inserts`, `perf-testing`, `workbook-inserts`, `temp-local-inserts`, `deploy-inserts`) — which is *every* real `temp-local-inserts-<slug>` branch folder. Left unanswered (the previous behavior), the spawned process hangs forever with no error — confirmed by direct reproduction. The helper writes `"y\n"` to `child.stdin` immediately after spawning; imc's destinations are always programmatic and pre-validated, so auto-confirming is correct here, not just expedient.

**Signature:** `onLine(line)` streams output as it arrives; `onDone({ success, killed, code, signal })`. Returns `{ cmd, kill() }` — `kill()` sends `SIGTERM` once, safe to call again. `pullFolderAsync`/`syncFolderAsync` wrap this in their own `onDone` shape (see their docstrings) and both now return `{ cmd, kill }` too.

**App.jsx state:** a single `pullState` object (`{ kind, target, cmd, kill, lastLine, done, success, killed }`) replaces what used to be a bare `pulling` string — only one pull/sync runs at a time. The full output buffer lives in a separate `pullLinesRef` (not in state, to avoid an array copy on every throttled render); `startPull`/`onPullLine`/`finishPull` in `App.jsx` are the only places that should touch either. `ErrorLogPanel`/`ErrorLogModal` still take a plain string — pass `pullingLine` (derived: `pullState && !pullState.done ? pullState.lastLine : null`), not `pullState` itself.

**Full output + cancel** — `p` (`viewPull`) opens `PullLogModal` (`Modals.jsx`, reuses the same private `LogViewer`/`useLogLayout` as `ErrorLogModal`/`FullLogModal`) showing the complete scrollable output of the current/last pull; `x` (`cancelPull`) kills an in-flight one, from the main view or from inside the modal. **Footer note:** these two entries are only added to `Footer`'s `actions` array while `pulling` is true (not just dimmed via `active` — actually absent) — the footer already wraps at common widths with its ~17 baseline entries (see "Layout math"), so don't make them permanent for a feature that only matters during the small fraction of time a pull is running.

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
