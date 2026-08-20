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

**Esc must always be `onCancel`, never a save/confirm action** — even for a modal that's a multi-step editing session rather than a single yes/no prompt. `KeybindingsModal` used to route `key.escape` to `onSave(local)` (no true cancel existed), which meant a session with a stale in-memory copy of `bindings` (e.g. left open while the file changed some other way) would silently clobber the newer file contents on close. Fixed by giving it a dedicated `s` = save-and-close, matching every other modal's `Esc` = cancel.
- Pass `onConfirm={handleMyAction} onCancel={() => setModal(null)}`

## core.js conventions

- All exports are plain functions — no classes, no state.
- All I/O is synchronous (`fs.readFileSync`, `fs.cpSync`, `fs.rmSync`).
- Every write function validates that its target name starts with `INSERT_PREFIX` before touching the filesystem. Do not skip this.
- Every folder-path lookup goes through the private `resolveFolderPath(name)` helper — never hand-roll `path.join(INSERTS_BASE, someName)` again. The rule is purely "is `name` the literal string `ACTIVE_FOLDER`?", not "is this the currently-loaded folder?" — a branch that happens to be loaded right now still resolves to `BRANCHES_BASE`; only the bare working-copy directory resolves to `INSERTS_BASE`.
- `loadFolder(name)` returns `null` if the directory doesn't exist — callers must handle null.
- `loadAllFolders()` always puts the active folder (`temp-local-inserts`) first.
- **A branch must never have zero `.json` files.** `createFolder(name, null)` (the "(none)" base option in `NewFolderModal`) writes one placeholder `donor.json: []` rather than an empty directory — confirmed by reading `snovault/loadxl.py`'s `load_local_data()`: it only checks whether `temp-local-inserts` has *any* `.json` file at all; find zero, and the portal silently falls back to loading `demo_inserts`/the real `inserts/` fixtures instead of an actually-empty working copy. Which type the placeholder is doesn't matter (types are discovered dynamically, and an empty list is a no-op either way) — this is the reason `temp-local-inserts-empty` (a folder with ~29 empty-array type files) existed as a manual template before this fix; a single placeholder file does the same job, so that folder is now redundant, not required.
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
