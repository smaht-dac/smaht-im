# smaht-im — SMaHT Inserts Manager

Two tools for managing smaht-portal inserts during local development:

| Tool | Description |
|------|-------------|
| `im` | Command-line tool: pull, track, diff, and repull inserts |
| `imc` | **TUI** (lazygit-style): browse folders, load, snapshot, move items |

All state (manifests, activation history) is stored in `~/.smaht-im/` — never
committed to the portal repo.

---

## How it works

Both tools operate on the same inserts directory inside your local smaht-portal checkout:

```
~/dbmi/smaht-portal/src/encoded/tests/data/
  ├── master-inserts/             ← live portal data — never touched
  ├── workbook-inserts/           ← live portal data — never touched
  ├── temp-local-inserts/         ← working copy (what portal loads)
  ├── temp-local-inserts-main/    ← named branch
  ├── temp-local-inserts-devtest/ ← named branch
  └── temp-local-inserts-staging/ ← named branch
```

### The branch model

`imc` manages inserts folders like git branches. `temp-local-inserts/` is the
**working copy** — the folder smaht-portal reads. Named folders
(`temp-local-inserts-<name>/`) are branches you switch between.

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
temp-local-inserts  (working copy — portal reads this)
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

## imc — Inserts Manager TUI

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
│ [n] New  [r] Rename  [a] Load  [s] Snap  [m] Move  [d] Diff  [Del] Delete  [?]  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

`●` marks the currently loaded folder (HEAD). `✓` marks items selected with Space.

### Key actions

| Key | Panel | Action |
|-----|-------|--------|
| `a` | Folders | **Load** selected folder — replaces `temp-local-inserts` contents, updates HEAD |
| `Space` | Folders | **Load** selected folder (same as `a`, quick-select shortcut) |
| `s` | Folders | **Snapshot** — copy working copy to a named `temp-local-inserts-<name>` |
| `n` | Folders | **New folder** — create an empty branch (optionally forked from an existing one) |
| `r` | Folders | **Rename** selected folder |
| `d` | Folders | **Diff** selected folder vs `temp-local-inserts` |
| `Del` | Folders | Delete selected folder (with confirmation) |
| `Space` | Items | Toggle item selection (multi-select) |
| `m` | Items | **Move** selected items to another folder |
| `ctrl+a` | Items | Select all items in the current type |
| `Esc` | Items | Clear item selection |
| `Tab` / `Shift+Tab` | Global | Move focus between panels |
| `R` | Global | Refresh all folders from disk |
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
    ...                              ← press Esc to save & close
```

The editor prevents collisions — if a key is already in use, it rejects the
new binding and shows which action owns it. Reserved keys (Esc, Enter, Tab,
arrow keys) can never be bound.

Space is context-aware and cannot be separately configured per panel — whatever
key is bound to "Toggle / load" acts as the load shortcut in the Folders panel
and the selection toggle in the Items panel.

Default keybindings:

| Action | Key |
|--------|-----|
| New folder | `n` |
| Rename | `r` |
| Load folder | `a` / `Space` |
| Snapshot | `s` |
| Diff | `d` |
| Delete folder | `Del` |
| Move items | `m` |
| Toggle / load | `Space` |
| Select all | `ctrl+a` |
| Refresh | `R` |
| Edit keybindings | `K` |
| Help | `?` |
| Quit | `q` |

---

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

## im — CLI tool

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
scratch, copy it from wherever you keep it — it is a single self-contained
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

Outside it — running `im` from `~`, `/tmp`, or any other directory — pyenv
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

## File layout

```
~/smaht-im/
  im.py        — Python CLI (im)
  src/         — Node.js TUI source (imc)
  dist/        — built output (imc.js) — generated, not committed
  README.md    — this file

~/.smaht-im/
  HEAD                          — currently loaded folder name
  activation-history.json       — log of every load operation
  keybindings.json              — custom key bindings (optional)
  temp-local-inserts.json       — manifest per workspace
  my-workspace.json
  ...
```
