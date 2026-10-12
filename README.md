# smaht-im - SMaHT Inserts Manager

Two tools for managing smaht-portal inserts during local development:

| Tool | Description |
|------|-------------|
| `im` | Command-line tool: pull, track, diff, and repull inserts |
| `imc` | **TUI** (lazygit-style): browse folders, load, snapshot, move items |

All state (manifests, activation history) is stored in `~/.smaht-im/` - never
committed to the portal repo.

> **Before you pull anything:** data pulled from a live portal environment is
> real donor/sample/tissue data, and may be protected, not just an
> anonymous test fixture, even when nothing in it looks obviously sensitive.
> Keep it local. Don't commit it, paste it into an issue/PR/chat, upload it
> anywhere, or include it in a screenshot, unless it's a recognized public
> reference dataset (e.g. COLO829T) or has gone through the anonymization
> step described in [Sharing inserts data safely](#sharing-inserts-data-safely)
> below, and even then, real sharing still needs sign-off through actual data
> governance, not just this tool's say-so.

---

## Getting started on a fresh machine

What's needed, roughly in order:

1. **Node.js 24**, via [nvm](https://github.com/nvm-sh/nvm) (matches `.nvmrc`):
   ```bash
   nvm install 24
   ```
2. **This repository**, checked out to `~/smaht-im`, with its Node dependencies built:
   ```bash
   cd ~/smaht-im && npm install && npm run build
   ```
3. **A local `smaht-portal` checkout**, `~/dbmi/smaht-portal` by default (override with `SMAHT_REPO_ROOT`, see [Environment variable overrides](#environment-variable-overrides)). This is where local inserts actually live (`src/encoded/tests/data/`), `im`/`imc` read and write there, they don't check it out for you.
4. **A `smaht311` Python environment with `snovault` installed.** This is the heaviest step, and it's smaht-portal's own setup, not this repo's, follow smaht-portal's own dev-environment instructions to get a working `smaht311` pyenv virtualenv with `snovault`/`dcicutils` installed. That's what actually provides the `update-inserts-from-server` command both tools shell out to for pulling data from the portal (see [Why `PYENV_VERSION` is required](#why-pyenv_version-is-required)). Everything else, browsing, loading, diffing, moving items, checking sync status, works without it.
5. **This project's own two Python dependencies**, into that same `smaht311` env:
   ```bash
   PYENV_VERSION=smaht311 pip install -r requirements.txt
   ```
6. **Portal credentials** at `~/.smaht-keys.json`, see [the `im` CLI's Prerequisites section](#prerequisites) for the expected shape. Getting real credentials issued is a separate, internal process, not covered here.
7. **Shell aliases** for both tools, add to `~/.bashrc` (or `~/.zshrc`):
   ```bash
   alias imc='source ~/.nvm/nvm.sh && nvm use 24 --silent && node ~/smaht-im/dist/imc.js'
   alias im='PYENV_VERSION=smaht311 python ~/smaht-im/im.py'
   ```

Once all of that's in place: `imc` for the TUI, or `im --help` for the CLI. Each tool's own section below covers its setup and prerequisites in more detail.

---

## How it works

Both tools operate on the inserts directory inside your local smaht-portal checkout -
but only the working copy and real portal fixtures live there. Named branches live
outside the checkout entirely, in imc's own state directory:

```
~/dbmi/smaht-portal/src/encoded/tests/data/
  ├── master-inserts/             ← live portal data - never touched
  ├── workbook-inserts/           ← live portal data - never touched
  └── temp-local-inserts/         ← working copy (what portal loads)

~/.smaht-im/branches/
  ├── temp-local-inserts-main/    ← named branch
  ├── temp-local-inserts-devtest/ ← named branch
  └── temp-local-inserts-staging/ ← named branch
```

Branches used to live alongside the working copy inside the portal checkout; they were
moved out since imc is the only thing that ever reads them (the portal itself only ever
reads the working copy) - keeping them outside the checkout means a branch operation can
never accidentally touch a real fixture like `master-inserts`. Every keybinding and
workflow described below is unchanged either way - only where things physically live
moved.

### The branch model

`imc` manages inserts folders like git branches. `temp-local-inserts/` is the
**working copy** - the folder smaht-portal reads. Named folders
(`temp-local-inserts-<name>/`) are branches you switch between, stored in
`~/.smaht-im/branches/`.

```
                   [a] or Space load                [s] snapshot "devtest"
temp-local-inserts-devtest  ──────►  temp-local-inserts  ──────►  temp-local-inserts-devtest
       (branch)                          (working copy)                    (branch)
```

Full cycle: load a branch → edit or pull new data → snapshot back under a name.

```
temp-local-inserts-main
        │
        │  [a] or Space (in Folders panel)
        ▼
temp-local-inserts  (working copy - portal reads this)
        │
        │  im pull --type Tissue   (fetch new items from remote)
        │
        │  [s] snapshot "tissue-work"
        ▼
temp-local-inserts-tissue-work
```

### Pulling from the portal

`im pull` fetches items from the remote portal into the working copy and saves a
manifest so the same query can be replayed later with `im repull`.

```
smaht portal  (data / wolf / staging)
      │
      │  im pull --type Donor --env data
      ▼
temp-local-inserts/donor.json   +  ~/.smaht-im/temp-local-inserts.json  (manifest)
      │
      │  im repull donor                           (replays saved query)
      ▼
temp-local-inserts/donor.json   (refreshed)
```

### Moving items between folders

Select items in the Items panel, then move them to any other folder.

```
temp-local-inserts-staging/donor.json  [4 donors]
      │
      │  [Space] mark 2 donors
      │  [m] move  →  devtest
      ▼
temp-local-inserts-staging/donor.json  [2 donors]
temp-local-inserts-devtest/donor.json  [+2 donors]
```

### Diffing folders

```
temp-local-inserts-devtest -- [d] diff --> side-by-side count table vs temp-local-inserts
```

---

## imc - Inserts Manager TUI

A lazygit-inspired full-terminal UI for browsing and managing all
`temp-local-inserts*` folders in the smaht-portal data directory.

### Layout

```
┌─ SMaHT Inserts Manager ─────────────────────────────────────────────────────────┐
│ ┌─ Folders ──────────────────────┐ ┌─ Types in temp-local-inserts-devtest ──────┐│
│ │ ● temp-local-inserts  [27]     │ │  aligned_reads.json  [20]                  ││
│ │   temp-local-inserts-devtest   │ │  analyte.json         [4]                  ││
│ │     [48]                       │ │  donor.json           [4]                  ││
│ │   temp-local-inserts-staging   │ │  output_file.json    [12]                  ││
│ │     [12]                       │ └────────────────────────────────────────────┘│
│ │   temp-local-inserts-test  [5] │ ┌─ Items in donor.json ───────────────────────┐│
│ │   temp-local-inserts-users [3] │ │ ✓  UUID                ID / Accession       ││
│ │                                │ │    06c2197d-8cbc…  BCM1_DONOR_P1740         ││
│ │                                │ │ ●  67ecc30b-3b71…  BCM1_DONOR_P5246  ←sel  ││
│ └────────────────────────────────┘ └────────────────────────────────────────────┘│
│ [n] New  [r] Rename  [a] Load  [s] Snap  [m] Move  [d] Diff  [D] Delete  [?]   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

`●` marks the currently loaded folder (HEAD). `✓` marks items selected with Space.
The rightmost column in Folders shows each folder's remote-tracking status:
`~` checking, `?` untracked (no query set), `✓` nothing new on the portal,
`↓N` N items available remotely but not local yet, `!` the last check errored.
A folder actively pulling/syncing shows a live spinner there instead, and the
footer shows an overall "N pulling" indicator whenever any folder has one in
flight, regardless of which panel is focused.

### Key actions

| Key | Panel | Action |
|-----|-------|--------|
| `o` | Global | **Toggle** the Folders panel between full width and a narrow strip showing just this key, bracketed (e.g. `[o]`). Auto-collapses the instant focus leaves Folders; only re-expands via this key or `Enter` while focused there (or automatically right after creating a new folder) |
| `/` | Global | **Find** an item by uuid (or part of one) across every folder, shows a live result list (`↑↓` to move, `Enter` to jump to it, opening its JSON detail view), marking which results are in the currently loaded folder. Built for pasting a uuid straight out of a `make deploy1`/`deploy2` validation failure in smaht-portal |
| `a` | Folders | **Load** selected folder - replaces `temp-local-inserts` contents, updates HEAD |
| `Space` | Folders | **Load** selected folder (same as `a`, quick-select shortcut) |
| `s` | Folders | **Snapshot** - copy working copy to a named `temp-local-inserts-<name>` |
| `n` | Folders | **New folder** - create a branch, optionally forked from an existing one and/or seeded by pulling one or more queries from the portal right away (chip-input: type a query, Enter to queue another, Enter on empty to create) |
| `N` | Folders | **New empty folder** - same as `n`, but defaults the base to `(none)` |
| `r` | Folders | **Rename** selected folder |
| `d` | Folders | **Diff** selected folder vs `temp-local-inserts` |
| `D` | Folders | Delete selected folder (with confirmation) |
| `e` | Folders | **Export** a de-identified copy to `~/smaht-im-exports/` (see [Sharing inserts data safely](#sharing-inserts-data-safely)) |
| `f` | Folders | **Sync** - re-run this folder's tracking query against the portal, merging in anything new. Streams live output; shows a diff if anything actually changed |
| `t` | Folders | **Set tracking query** - pick an env + query for this folder to sync against (`f`) and check staleness with |
| `A` | Folders | **Pull more** - queue one or more extra queries to pull into this folder without touching its stored tracking query |
| `p` | Folders | **View pull output** - full scrollable log of the current/last pull for the highlighted folder (shown only while/just after one has run) |
| `x` | Folders | **Cancel** an in-progress pull/sync for the highlighted folder |
| `H` | Folders | **History** - browse and restore this folder's pre-sync/restore backups (newest first, up to 10 kept) |
| `y` | Folders | **Copy** every item in the folder (or all selected folders, merged) to the clipboard as JSON (`{ typeName: [...] }`) |
| `y` | Types | **Copy** every item in the highlighted type to the clipboard as a plain JSON array |
| `E` | Types / Items | **Edit** the highlighted type's JSON file directly in `$EDITOR`/`$VISUAL` (falls back to `vi`), for hand-edits the app has no dedicated UI for (arbitrary interleaving, editing field values). Backs the folder up first (`H` to restore). If this folder is currently loaded, the edit is mirrored into the working copy immediately, so it isn't mistaken for an external edit and auto-snapshotted into a new folder next launch |
| `v` | Folders | **Range select** - mark the start here, move, press again to select every folder in between |
| `Space` | Items | Toggle item selection (multi-select) |
| `m` | Items | **Move** selected items to another folder |
| `a` / `b` | Items | **Reorder** - move selected items to right after / before the highlighted (unselected) item, same type file. Useful when one insert references another by UUID and the referenced item needs to load first (e.g. `unaligned_reads`' `R2` entries needing to come after their `R1`) |
| `y` | Items | **Copy** selected items (or the highlighted one) to the clipboard as JSON |
| `v` | Items | **Range select** - mark the start here, move, press again to select every item in between |
| `^A` (ctrl+a) | Items | Select all items in the current type |
| `f` | Items | **Sync** - re-fetch just the highlighted item from the portal and replace it in place. Shows a field-level diff if anything changed |
| `Enter` | Items | View highlighted item as a collapsible JSON tree in a panel on the right - closes when focus leaves Items |
| `Tab` / `l` | Items | Move focus into the JSON tree panel (only while it's open) |
| `↑↓` / `jk` | Item detail | Move within the JSON tree |
| `Enter` / `Space` | Item detail | Expand / collapse the highlighted node |
| `c` | Item detail | Collapse every node |
| `z` | Items / Item detail | Open the JSON tree full-screen (same commands apply); `z`/`Esc` closes it |
| `Esc` | Items / Item detail | Clear item selection, or close the JSON tree panel |
| `Tab` / `Shift+Tab` | Global | Move focus between panels |
| `R` | Global | Refresh all folders from disk |
| `L` | Global | Expand the session error log (clears on quit) |
| `F` | Global | View the full on-disk log (`~/.smaht-im/imc.log`, survives restarts, last 500 lines) |
| `K` | Global | Edit keybindings |
| `?` | Global | Help screen |
| `q` | Global | Quit |

### Load / snapshot workflow

```
[a] or Space on temp-local-inserts-devtest
        │
        ▼
  copies devtest/ → temp-local-inserts/   (working copy updated)
  HEAD = temp-local-inserts-devtest
        │
        │  (make changes, run im pull, etc.)
        │
[s] snapshot "devtest-v2"
        │
        ▼
  copies temp-local-inserts/ → temp-local-inserts-devtest-v2/
```

### Keybindings

All action keys are configurable. Press `K` in the TUI to open the keybindings
editor, or edit `~/.smaht-im/keybindings.json` directly.

```
[K] Keybindings editor
  ▶ New folder            n          ← navigate with ↑↓ / jk
    Rename folder         r
    Load folder           a          ← press Enter to rebind
    Snapshot working copy s          ← press R to reset all defaults
    ...                              ← press s to save & close, Esc to cancel
```

The editor prevents collisions - if a key is already in use, it rejects the
new binding and shows which action owns it. Reserved keys (Esc, Enter, Tab,
arrow keys) can never be bound.

Space is context-aware and cannot be separately configured per panel - whatever
key is bound to "Toggle / load" acts as the load shortcut in the Folders panel
and the selection toggle in the Items panel.

Default keybindings:

| Action | Key |
|--------|-----|
| New folder | `n` |
| New folder (empty base) | `N` |
| Rename | `r` |
| Load folder | `a` / `Space` |
| Snapshot | `s` |
| Diff | `d` |
| Delete folder | `D` |
| Export de-identified copy | `e` |
| Move items | `m` |
| Copy to clipboard | `y` |
| Edit type file in `$EDITOR` | `E` |
| Toggle Folders panel | `o` |
| Find item by UUID | `/` |
| Range select | `v` |
| Toggle / load | `Space` |
| Select all | `^A` (ctrl+a) |
| Sync from portal | `f` |
| Set tracking query | `t` |
| Pull more (new query) | `A` |
| View pull/sync output | `p` |
| Cancel pull/sync | `x` |
| View folder backup history | `H` |
| Refresh | `R` |
| Expand error log | `L` |
| View full log file | `F` |
| Edit keybindings | `K` |
| Help | `?` |
| Quit | `q` |

A few keys are fixed and don't go through this rebindable system at all, so
they're not in the editor or the table above: `a`/`b` to reorder selected
items (Items panel), and `Enter`/`Space`/`c`/`z`/arrows/`j`/`k` inside the
item JSON detail view.

---

**What imc needs to run:** Node.js 24 (below) is enough for browsing, loading, diffing, and moving items between folders you already have locally. Pulling or syncing data from the portal (`f`, `A`, creating a folder with a query) additionally needs the same `smaht311` Python environment `im` does, see [the `im` CLI's Prerequisites section](#prerequisites) further down, since imc shells out to the same `update-inserts-from-server`. The clipboard-copy keybinding (`y`) is macOS-only.

### Setup

```bash
# 1. Install dependencies
cd ~/smaht-im && npm install

# 2. Build
npm run build

# 3. Add alias to ~/.bashrc
alias imc='source ~/.nvm/nvm.sh && nvm use 24 --silent && node ~/smaht-im/dist/imc.js'

# 4. Reload shell and run
source ~/.bashrc
imc
```

For development (auto-rebuild + auto-restart on save):

```bash
npm run dev
```

---

## im - CLI tool

### Prerequisites

- **pyenv** installed and initialised in your shell profile
- **smaht311** virtualenv exists with the following packages installed:
  - `snovault` (provides `update-inserts-from-server`)
  - `click` (provides the CLI framework for `im.py` itself)
  - `requests` (used by `im coverage`)
- **`~/.smaht-keys.json`** exists with your portal credentials (same file used
  by `update-inserts-from-server`)

### Verify prerequisites

```bash
# confirm the virtualenv exists
pyenv versions | grep smaht311

# confirm the commands are available in that env
PYENV_VERSION=smaht311 python -m click --version
PYENV_VERSION=smaht311 update-inserts-from-server --help

# confirm the keys file exists
ls ~/.smaht-keys.json
```

---

## Setup

### 1. Check out the script

The script lives at `~/smaht-im/im.py`. If you need to restore it from
scratch, copy it from wherever you keep it - it is a single self-contained
Python file.

### 2. Add the alias to your shell profile

Add the following line to `~/.bashrc` (or `~/.zshrc` if you use zsh):

```bash
# SMaHT inserts manager
alias im='PYENV_VERSION=smaht311 python ~/smaht-im/im.py'
```

`PYENV_VERSION=smaht311` overrides pyenv's directory-based version selection
so that `im` works from any directory, not just inside the smaht-portal repo.

### 3. Reload your shell

```bash
source ~/.bashrc   # or source ~/.zshrc
```

### 4. Confirm it works

```bash
im --help
im status
```

---

## Why `PYENV_VERSION` is required

pyenv selects a Python version based on the closest `.python-version` file
found walking up from the current directory. The smaht-portal repo has
`smaht311` in its `.python-version`, so `python` resolves correctly when you
are inside that directory tree.

Outside it - running `im` from `~`, `/tmp`, or any other directory - pyenv
falls back to the global version, which may not have `python` defined at all,
producing:

```
pyenv: python: command not found
```

Prefixing with `PYENV_VERSION=smaht311` pins the version for that single
invocation, regardless of where you are.

---

## Usage

All commands accept `--help` for a full option list.

> **Don't pass a `temp-local-inserts-<slug>` name to `--dir`.** `im`'s `--dir`
> always writes inside the portal checkout - it has no way to reach
> `~/.smaht-im/branches/`, where `imc` actually stores its named branches now.
> Using `--dir donor-only` (a plain name, like the examples below) is fine;
> using `--dir temp-local-inserts-devtest` will silently create a second,
> out-of-sync copy inside the portal checkout instead of updating the branch
> `imc` thinks that name refers to.

### `im status`

Show every item type in a workspace with counts, last-pulled date, and the
query that produced it.

```bash
im status                        # default workspace: temp-local-inserts
im status --dir my-workspace
im status --all                  # every workspace that has a manifest
```

### `im pull`

Pull inserts from the portal. Saves the query to the manifest so you can
replay it later.

```bash
# Pull by type (one search per type)
im pull --type Donor
im pull --type Donor --type Sample --type Tissue

# Pull by type with an extra filter
im pull --type OutputFile --search "status=released"
im pull --type OutputFile --search "status=released&data_category=Genome"

# Pull specific UUIDs
im pull --uuid cdde7e4a-fa40-4959-b5e6-099b8fe913aa
im pull --uuid UUID1 --uuid UUID2 --uuid UUID3

# Pull UUIDs from a file (one UUID per line, # lines are comments)
im pull --uuid-file my-uuids.txt

# Pull into a named workspace
im pull --type Donor --dir donor-only

# Pull from a different environment
im pull --type Donor --env wolf
im pull --type Donor --env staging

# Replace existing data instead of merging
im pull --type Donor --refresh
```

UUID batches are capped at 80 per request to stay within URL length limits.
Multiple batches are fired automatically.

### `im repull`

Re-run the saved query for one or more types without having to remember the
original filter.

```bash
im repull donor
im repull donor output_file tissue

im repull --all                  # re-run every type in the manifest
im repull --stale 7              # only re-pull types not refreshed in 7 days
im repull --stale 7 --all        # combine: stale check across all types

# Override the saved environment
im repull donor --env wolf
```

### `im coverage`

Query the portal and diff its UUID set against your local files. Useful for
knowing what you are missing before running `im pull`.

```bash
im coverage                      # check all local types against env=data
im coverage --env wolf
im coverage --type Donor         # check a single type
im coverage --type Donor --type Tissue

# Print the missing UUIDs (with accession/identifier) below the table
im coverage --show-missing
im coverage --type Donor --show-missing --env wolf
```

Output columns: `Local` (your file count), `Remote` (portal total),
`Missing` (remote − local).

### `im workspaces`

List every workspace that has a manifest in `~/.smaht-im/`.

```bash
im workspaces
```

Directories that no longer exist on disk are flagged with `!`.

---

## Manifest format

Each workspace has a manifest at `~/.smaht-im/{workspace-name}.json`:

```json
{
  "dest": "temp-local-inserts",
  "env": "data",
  "types": {
    "donor": {
      "count": 4,
      "env": "data",
      "last_pulled": "2026-05-01T10:32:00",
      "query": "type=Donor"
    },
    "output_file": {
      "count": 20,
      "env": "data",
      "last_pulled": "2026-05-01T11:00:00",
      "query": "type=OutputFile&status=released"
    }
  }
}
```

The manifest is the source of truth for `im status` and `im repull`.
It is never read by the portal or committed to the repo.

---

## Environment variable overrides

| Variable | Default | Purpose |
|---|---|---|
| `SMAHT_REPO_ROOT` | `~/dbmi/smaht-portal` | Root of the smaht-portal checkout |

Example:

```bash
SMAHT_REPO_ROOT=~/other/smaht-portal im status
```

---

## Adding `click` or `requests` to the smaht311 env

If either package is missing:

```bash
PYENV_VERSION=smaht311 pip install click requests
```

---

---

## Sharing inserts data safely

Inserts pulled by `im pull` are real donor/sample/tissue records from the
portal - not safe to paste into a bug report, attach to a ticket, or use as
example data as-is.

There are two equivalent ways to produce a de-identified copy of a
`temp-local-inserts*` folder - same underlying implementation
(`anonymizeFolder()` in `src/core.js`), pick whichever is more convenient.
**Neither runs automatically** - both require you to explicitly ask for it.

**From imc:** highlight a folder in the Folders panel and press `e`
(Export de-identified copy). You'll be prompted for an export name and an
optional seed, then the result is written to `~/smaht-im-exports/` - the
working copy and every other folder are left untouched, and nothing is
re-pulled, re-synced, or refreshed as a side effect.

**From the command line:**

```bash
node scripts/anonymize-inserts.js temp-local-inserts-devtest ~/smaht-im-exports/devtest-anon --seed=ticket-1234
```

What it does:

- Remaps every UUID consistently across **all** type files in the folder,
  so links like `sample.donor -> donor.uuid` still resolve after
  anonymizing.
- Scrubs or fakes fields matched by name (`submitted_id`, `notes`,
  `accession`, etc. - see `DEFAULT_POLICY` in the script, or override with
  `--config=path/to/config.json`, starting from
  `scripts/anonymize.config.example.json`).
- Jitters date fields by a random +/- N days (`--jitter-days`, default 30).
- **Shuffles** quasi-identifier columns (age, sex, race, cause of death,
  etc.) across records of the same type - a real permutation of the
  existing values, not fake data, so the aggregate distribution for that
  type is unchanged but which value belongs to which record is broken.
  Groups smaller than 5 records are redacted instead of shuffled, since
  permuting a handful of values isn't real protection.
- Writes a `_ANONYMIZATION_REPORT.json` alongside the output listing
  exactly what happened to every field, for review before sharing.
- Pass `--seed=<phrase>` for a fully reproducible run (same input + seed →
  same output); omit it for a fresh random remap.

Output goes to `~/smaht-im-exports/` by default - outside the portal's
inserts directory, so it's never mistaken for a working `temp-local-inserts*`
branch.

**Limits - read before sharing anything:**

- Only the JSON insert records are touched. Any sequence/genotype files
  referenced by these records are not de-identified by this script.
- Small cohorts stay re-identifiable to someone who already knows something
  about them, regardless of shuffling - this reduces risk, it doesn't
  guarantee anonymity.
- The default field-name policy is a generic guess. Review and extend it
  against the real SMaHT schema (`--config`) before trusting it.
- This is engineering hardening, not a compliance decision. Route real
  donor-derived data through Harvard/SMaHT data governance (DUA, DAC
  approval, IRB as applicable) before it leaves the team, regardless of
  what this script does to it.

---

## File layout

```
~/smaht-im/
  im.py        - Python CLI (im)
  src/         - Node.js TUI source (imc)
  dist/        - built output (imc.js) - generated, not committed
  README.md    - this file

~/.smaht-im/
  HEAD                          - currently loaded folder name
  activation-history.json       - log of every load operation
  keybindings.json              - custom key bindings (optional)
  temp-local-inserts.json       - manifest per workspace
  my-workspace.json
  ...
  branches/                     - named branches (temp-local-inserts-<slug>/), see "How it works"
  backups/                      - pre-sync/restore snapshots, browsable via imc's History (`H`)
```

---

## License

MIT, see [LICENSE](LICENSE).
