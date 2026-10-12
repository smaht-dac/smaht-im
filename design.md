# design.md — smaht-im brainstorming & design notes

Living scratchpad for pain points and feature ideas for `im` / `imc`. Not a
commitment to build anything here — just a place to dump ideas before they're
triaged into real work. Add to it freely; prune once something ships or gets
rejected.

Grounded in the code as of the `App.jsx`/`core.js`/`Panels.jsx`/`Modals.jsx`
split described in `CLAUDE.md`. File/function references below point at where
each idea would actually land.

---

## Pain points & limitations (current state)

### Navigation & discovery

- **No per-panel type-ahead filter.** The Folders, Types, and Items panels
  (`Panels.jsx`) still only support `j`/`k` / arrow-key scrolling via
  `visibleWindow()` for in-panel navigation. Once a folder has a few dozen
  branches or a type has a few hundred items, narrowing *that list* means
  scrolling past everything else — there's no jump-to-letter or live filter
  on folder/type/item name within a panel. (Finding a known UUID across every
  folder is a solved, separate problem now — see `/` in `CLAUDE.md`'s
  "Search" section — this bullet is specifically about filtering the list
  you're already looking at.)
- **Base-branch picker in `NewFolderModal` doesn't scale.** It's a
  left/right arrow slider over `baseOpts` — fine for a handful of folders,
  unwieldy once there are 15+.

### Data safety & recoverability

- **Deletes are permanent, with no undo.** `deleteFolder()` in `core.js`
  does `fs.rmSync(..., { recursive: true, force: true })` straight away.
  `DeleteModal` is the only guard — a fat-fingered `y` on the wrong folder
  loses everything in it. There's no trash/soft-delete, no "last deleted
  folder" recovery.
- **`moveItems()` mutates JSON files in place with no backup.** If a move
  goes to the wrong destination there's no automatic way back short of
  manually re-editing the JSON or hoping a snapshot exists.
- **Snapshots are entirely manual.** Nothing snapshots the working copy
  automatically before a destructive action (load, delete, move) — the only
  auto-snapshot behavior is the "working copy doesn't match HEAD" check in
  `loadAllFolders()`, which is about detecting *external* drift, not
  protecting against imc's own actions.
- **No confirmation diff before Load.** `LoadModal` shows item *counts* for
  current vs. target but not *what actually changes* — you find out via
  count deltas only after switching.

### Bulk / cross-cutting operations

- **Selection is scoped to one type at a time.** `selectedUuids` is a flat
  `Set`, but it's only ever populated from `currentItems` (the currently
  open type). There's no way to select items across multiple types and move
  or sync them together in one action.
- **Item sync (`f` in Items panel) only ever acts on the cursor item**
  (`currentItems[itemIdx]` in `handleSyncItem`), never on `selectedUuids` —
  inconsistent with Move, which *does* operate on the full selection. Same
  is true for delete: there's no per-item delete at all, only per-folder.
- **Move is destructive-only — no "copy" mode.** `moveItems()` always
  removes from source. There's no way to duplicate items into another
  branch for comparison/testing while leaving the original untouched.

### Pull / query workflow (imc vs. `im.py`)

- **`NewFolderModal`'s pull is still free-text, not type-aware.** It now
  supports queuing several queries in one batch before creating the folder
  (chip-input, same UX `PullMoreModal` uses — see `CLAUDE.md`'s "Seeding a
  new folder from several queries"), so "one shot" is no longer accurate.
  What's still missing: there's no autocomplete of known type names and no
  validation that a query string is well-formed before it's sent — each
  queued entry is still hand-typed free text.
- **No "coverage" view inside imc.** `im coverage --show-missing` (CLI)
  answers "what am I missing locally vs. the portal" per type, but imc's
  remote tracking only ever surfaces the `behind` count (`↓N`) in the
  Folders panel — `ahead` is computed too but deliberately never shown (see
  `CLAUDE.md`'s "Indicator column" note on why), and neither path lets you
  see *which* UUIDs are missing, or drill in, without dropping to the CLI.
- **Env list is duplicated and hardcoded.** `ENVS` in `Modals.jsx`
  (`NewFolderModal`) and `TRACKING_ENVS` (`SetQueryModal`) are two separate
  arrays with the same four values — adding a fifth environment means
  editing two places and rebuilding, with no config file backing it.

### Remote tracking edge cases

- **5-minute cache TTL is fixed and invisible.** `checkRemoteAsync`'s cache
  in `__remote_cache__` isn't surfaced anywhere in the UI — there's no way
  to tell "this `↓3` is 4 minutes stale" vs. force a re-check without
  waiting or doing an action that happens to trigger one.
- **No credential health check.** If `~/.smaht-keys.json` is missing an
  entry for an env, you only find out when a sync/pull/tracking check fails
  mid-flight (`loadEnvAuth` returns `null` → error surfaces in the log
  panel). There's no upfront "which envs do I have working credentials for"
  view.
- **Staleness check pulls credentials serially per environment but the
  fan-out is per-type** (`checks` in `checkRemoteAsync`) — for a folder
  tracked across many types this is a lot of parallel requests with no
  visible per-type progress, just a single terminal `checking`/`ok`/`error`
  state.

### Observability & feedback

- **Auto-snapshot-on-drift is silent.** When `loadAllFolders()` detects the
  working copy doesn't match HEAD and creates a timestamped folder, nothing
  tells the user *why* a new `temp-local-inserts-20260814-1032` folder just
  appeared in their list. It's a genuinely useful safety net, but it reads
  as unexplained TUI behavior on first encounter.
- **Error log excerpts can still get truncated mid-line.** `F`
  (`FullLogModal`) now reads the persistent on-disk log (`~/.smaht-im/imc.log`,
  last 500 lines, survives restarts) so the "closing imc loses the history"
  half of this is fixed — but the in-app `L` view is still the capped
  50-entry session `errorLog`, and a long stack trace shown inline is still
  `trunc(e, 116)`'d with no "open in $EDITOR" for the full text either way.

### Engineering / quality

- **No linter/formatter config** visible in the repo — style consistency
  across `src/*.jsx` relies on convention only.

---

## Potential features

Rough grouping, not a priority order. Each entry notes where it'd plug into
the existing architecture.

### Search & navigation

- **Type-ahead filter in every panel.** Press `/` while a panel is focused
  to filter its list live (folders by name, types by name, items by UUID/
  displayId/status). Fits naturally alongside the existing `useInput` guards
  in `Panels.jsx`; would need a small `filterText` state per panel or lifted
  into `App.jsx` next to `focus`.
- **Type-to-filter in `NewFolderModal`'s base-branch picker** once folder
  count grows past a screenful, instead of the current left/right slider.

### Data safety

- **Soft delete / trash.** Rename deleted folders to a
  `temp-local-inserts-.trash-<name>-<timestamp>` prefix instead of
  `fs.rmSync`, with a periodic sweep (or manual "empty trash") for real
  removal. Still respects the `INSERT_PREFIX` guard invariant since the
  trashed name still starts with it.
- **Auto-snapshot before destructive actions.** Before `switchFolder`
  (Load) or `deleteFolder`, snapshot the current working copy or target
  automatically (silently, or with a lightweight "safety snapshot created"
  notification) — extends the pattern that already exists for drift
  detection in `loadAllFolders()`.
- **Copy mode for items**, alongside the existing Move. Same modal, an
  extra keybinding or a toggle in `MoveModal` (`c` = copy, `m` = move) that
  skips the `remaining` filter/`unlinkSync` step in `moveItems()`.
- **Bulk item delete.** A `DeleteItemsModal` mirroring `DeleteModal`'s
  confirm pattern, operating on `selectedUuids` within the current type —
  currently the only way to remove items is to move them somewhere and
  delete that folder.
- **Diff preview before Load**, not just counts — reuse `computeDiff()`
  (it already exists and is used for the Diff modal) to show *which* types/
  UUIDs would actually change in `LoadModal` before confirming.

### Bulk / cross-cutting

- **Cross-type selection.** Let `selectedUuids` carry `{ type, uuid }` pairs
  instead of bare UUIDs, so a selection can span multiple types in one
  folder and Move/Sync/Delete can act on the whole batch in one pass.
- **Bulk item sync.** Extend `handleSyncItem` to operate over
  `selectedUuids` (falling back to the cursor item when nothing is
  selected, to preserve current single-item behavior) — same UX pattern
  Move already uses.

### Pull / query workflow

- **Type-aware query builder in `NewFolderModal`.** The chip-input batch
  (type a query, Enter to queue another) already shipped — see "Pain
  points" above — but each entry is still hand-written free text. Let the
  user pick one or more known types (autocompleted from existing folders'
  type names) plus an optional filter, and compose the underlying
  `--search` query automatically instead of hand-writing
  `?type=Donor&status=released`.
- **`im coverage`-style drill-down in imc.** Add a "show missing UUIDs" view
  off the remote-status indicator — reuse the existing UUID-set diff logic
  in `checkRemoteAsync` but surface the actual missing/extra UUID lists
  (with `displayId`) instead of just counts.
- **Single source of truth for env list.** Move `ENVS` /
  `TRACKING_ENVS` into `core.js` (or a small `envs.js`) read once, ideally
  backed by `~/.smaht-keys.json`'s actual keys so the env picker only shows
  environments you actually have credentials for.

### Remote tracking

- **Surface cache age.** Show "checked 3m ago" next to the `✓`/`↓N`
  indicator, sourced from `__remote_cache__.checked_at`, plus a manual
  "force re-check" keybinding that bypasses the 5-minute TTL.
- **Credentials health screen.** A small modal listing each env in
  `~/.smaht-keys.json` and whether `loadEnvAuth()` resolves it successfully,
  so missing/malformed credentials show up before a sync fails mid-flight.
- **Per-type progress during a multi-type staleness check**, rather than a
  single aggregate `checking` state, so it's clear which type is slow or
  failing when a tracked folder covers many types.

### Folder organization

- **Folder notes/description.** A free-text note per folder (stored
  alongside `__tracking__` in the same `~/.smaht-im/{folder}.json`
  sidecar) — "what is this branch for" — shown in `OverviewPanel`.
  Useful once there are more than a few named branches and their purpose
  is only in someone's memory.
- **Pin/favorite folders** to keep a couple of go-to branches pinned to the
  top of `FolderPanel` regardless of recency sort.
- **Explicit notification when auto-snapshot-on-drift fires**, so the
  "why did a new timestamped folder just appear" moment in
  `loadAllFolders()` becomes a visible `notify()` call instead of a silent
  side effect discovered on the next refresh.

### Engineering / quality

- **Lint/format config** (eslint + prettier, or biome) to keep `src/*.jsx`
  consistent as the TUI grows. (Unit tests and error-log persistence, both
  listed here previously, have since shipped — see `CLAUDE.md`'s "Tests"
  and "Error log persistence" sections.)

### Feature-aware insert recommendation (schema-driven)

*The `scripts/recommend-inserts.js` prototype referenced throughout this
section has been removed from the repo (unwired, undocumented outside this
file, not appropriate to ship while making this tool shareable with the
team). The findings below are still accurate and still the starting point
if this gets built for real, see git history for the prototype's code.*

Prompted by: "if I'm updating publication items I want a representative set
of publications and their static sections; if I'm fixing a donor browse
page bug I want donors and protected donors — can this be discerned
reliably, and how?"

**Verdict, checked against the real schemas in this checkout (not
guessed):** the structural half — given a starting type, what else is
connected to it and how — is reliably automatic. The semantic half —
mapping free-text like "donor browse page bug" to a starting type — is not,
and needs a human to confirm the seed before expanding. Prototyped as
`scripts/recommend-inserts.js`; read-only, prints a plan, pulls nothing.

**Why the structural half is reliable:** `linkTo` in the JSON schemas is an
exact, machine-readable declaration, and reverse relationships don't need
any special handling — they fall out for free by scanning every schema for
`linkTo: "X"` and recording the edge in both directions. Confirmed against
the real `donor.json` / `protected_donor.json`: `Donor.protected_donor` has
`linkTo: "ProtectedDonor"`, and that single forward declaration is enough
for the tool to find `Donor` when *starting* from `ProtectedDonor`, with no
need to parse the Python `rev = {...}` calculated-property dicts in
`types/*.py` at all. Same mechanism found `Publication → StaticSection`
(via `static_content`, a field that only exists in `mixins.json`'s
`static_embeds` block, pulled in through `publication.json`'s
`mixinProperties` — the tool resolves those `$ref`s, so mixin-only fields
aren't missed) and `Donor → Tissue → Sample` transitively.

Two other things came for free from the schemas, not guessed at:
- Every schema's own `facets` block (the fields the portal's real browse
  page facets on) is a ready-made, curated stratification scheme for a
  "representative" sample — including pre-defined bucket ranges for numeric
  fields. `donor.json` literally ships age buckets (18-30, 31-55, 56-65,
  66-75, 76-85, 86+) that the SMaHT team already decided are the
  meaningful cuts — no need to invent a sampling heuristic.
- Every schema's `columns` block is literally what's shown in that type's
  browse-page table — the most direct possible answer to "which fields
  matter for the X browse page."

**Where it's NOT reliable, seen firsthand in testing:** feeding the literal
phrase `"donor browse page bug"` as the query pulled in noisy false
matches (`DonorSpecificAssembly`, `Page`) alongside the correct `Donor` /
`ProtectedDonor`, because generic tokens like "page" and "bug" aren't
schema vocabulary. Feeding just `"donor"` was clean. So: keyword matching
against type titles/descriptions is a good way to generate a *ranked
candidate list*, not a good way to silently pick one — a real integration
needs a confirm step (pick from N candidates), not full automation.
Depth-2 expansion also grows fast — `"donor"` at depth 2 pulled in 20 types
including most of the File/QC hierarchy — so default depth should be 1,
with depth as an explicit, visible dial.

**Not yet attempted:** live facet counts from the portal's own `/search/`
responses (encoded-family portals typically return aggregation counts
alongside results) would let a sample be stratified by *actual* observed
proportions rather than the schema's declared possible values — noted as a
stronger version of the sampling step, unverified against this portal.

**Integration path, not yet built:** the prototype is a standalone read-only
script (`node scripts/recommend-inserts.js "<query>"`). Turning this into
something that actually pulls data means: (1) a confirm UI for the ranked
seed candidates — natural fit for either a new `im recommend` subcommand
(Python, sits next to `im pull`/`im coverage`, which already have the
portal-query machinery) or an imc modal; (2) turning the facet/column info
into actual `--search` query strings per type/bucket, which the current
tool only lists, it doesn't compose; (3) the same admin-type noise list
(`SubmissionCenter`, `Consortium`, `Workflow`, etc.) needs to stay
maintained as schemas change — it's a hardcoded exclude set in the
prototype, not derived from anything.

### Web UI for imc (Figma AI-generated)

Decided: v1 is a faithful port of imc's existing screens (not the
recommend-inserts flow above — that's v1.1), running as a local web app
against a thin server wrapping `core.js` (not a desktop app), styled as a
dense internal power-tool rather than a consumer dashboard.

A prompt-ready spec was drafted — screen inventory mapped 1:1 from imc's
panels and modals, synthetic sample content, and a states checklist — as
`figma-ui-brief.md`, with the actual paste-ready First Draft prompt in
`figma-first-draft-prompt.txt`. **Neither file is in this repo** (kept out
of version control deliberately, same reasoning as the removed
`recommend-inserts.js` prototype above — not appropriate to ship while
making this tool shareable with the team); check with whoever drafted them
if you need the content again. Notes worth keeping here regardless, since
they're easy to forget once a Figma file exists:

- First Draft takes a text prompt only (no reference images) and is built
  for common web patterns — a three-panel data manager with custom status
  badges isn't one, so expect 2-3 rounds of follow-up "structure" prompts
  before the shape matches, not one-shot success.
- Figma Make is the fallback if First Draft's shape doesn't hold up, or
  once an actual interactive prototype is wanted — it supports custom
  design systems and MCP integration, First Draft supports neither.
- A Figma connector exists in the org registry (not yet enabled in any
  session) whose `get_design_context` / `get_variable_defs` /
  `create_design_system_rules` tools become useful *after* a design
  exists, to pull it back out for building the real frontend — not useful
  before then.
- The local-web-app-plus-thin-server runtime choice means the only new UI
  surface beyond what imc already has is a small "connected to local
  server" status indicator — everything else is a straight screen-by-screen
  port.

---

## Open questions / needs a decision before building

- Cross-type selection changes the shape of `selectedUuids` — worth
  deciding early since Move, bulk-sync, and bulk-delete would all depend on
  the new shape.
- Soft-delete/trash changes what "no other folders available" means in
  `MoveModal`'s destination list (should trashed folders be excluded?) and
  what `loadAllFolders()` returns.
- Type-aware query builder needs a definition of "known types" — from
  existing local folders only, or from a portal schema fetch (more useful,
  more moving parts).
- Insert recommendation: CLI (`im recommend`) vs. imc modal — CLI reuses
  Python's existing portal-query code, imc keeps momentum in the "active
  focus" tool per `CLAUDE.md`. Needs a call before building past the
  read-only prototype.
