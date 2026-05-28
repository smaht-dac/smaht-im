#!/usr/bin/env python3
"""
imc — SMaHT Inserts Manager TUI

A lazygit-inspired terminal UI for browsing and managing smaht-portal inserts
across named workspaces.  All write operations are strictly limited to
directories whose names start with "temp-local-inserts".

Usage:
    python ~/smaht-im/imc.py

Add to ~/.bashrc:
    alias imc='PYENV_VERSION=smaht311 python ~/smaht-im/imc.py'

Install dependencies (once, into the smaht virtualenv):
    PYENV_VERSION=smaht311 pip install "textual>=0.61.0"
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── Dependency check ──────────────────────────────────────────────────────────

try:
    from textual.app import App, ComposeResult
    from textual.binding import Binding
    from textual.containers import Horizontal, Vertical, VerticalScroll
    from textual.coordinate import Coordinate
    from textual.message import Message
    from textual.reactive import reactive
    from textual.screen import ModalScreen
    from textual.widgets import (
        Button,
        DataTable,
        Footer,
        Header,
        Input,
        Label,
        ListItem,
        ListView,
        Markdown,
        Static,
    )
except ImportError:
    print(
        "\nError: 'textual' package not found.\n"
        "Install it with:\n"
        "  PYENV_VERSION=smaht311 pip install 'textual>=0.61.0'\n"
    )
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────────

REPO_ROOT = Path(
    os.environ.get("SMAHT_REPO_ROOT", str(Path.home() / "dbmi" / "smaht-portal"))
)
INSERTS_BASE = REPO_ROOT / "src" / "encoded" / "tests" / "data"
HISTORY_FILE = Path.home() / ".smaht-im" / "activation-history.json"
ACTIVE_FOLDER = "temp-local-inserts"
INSERT_PREFIX = "temp-local-inserts"

# ── Data model ────────────────────────────────────────────────────────────────


@dataclass
class InsertItem:
    uuid: str
    data: dict

    @property
    def display_id(self) -> str:
        return (
            self.data.get("submitted_id")
            or self.data.get("accession")
            or self.data.get("identifier")
            or self.data.get("title")
            or (self.uuid[:12] + "…" if self.uuid else "—")
        )

    @property
    def status(self) -> str:
        return self.data.get("status", "")


@dataclass
class InsertType:
    name: str   # stem of the .json file (snake_case)
    path: Path
    items: list[InsertItem] = field(default_factory=list)

    def load(self) -> None:
        self.items = []
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text())
            if isinstance(raw, list):
                self.items = [InsertItem(uuid=d.get("uuid", ""), data=d) for d in raw]
        except (json.JSONDecodeError, OSError):
            pass

    @property
    def count(self) -> int:
        return len(self.items)


@dataclass
class InsertFolder:
    name: str
    path: Path
    types: list[InsertType] = field(default_factory=list)

    @property
    def is_active(self) -> bool:
        return self.name == ACTIVE_FOLDER

    @property
    def total_items(self) -> int:
        return sum(t.count for t in self.types)

    def load(self) -> None:
        self.types = []
        if not self.path.exists():
            return
        for json_file in sorted(self.path.glob("*.json")):
            itype = InsertType(name=json_file.stem, path=json_file)
            itype.load()
            self.types.append(itype)

    def get_type(self, name: str) -> Optional[InsertType]:
        return next((t for t in self.types if t.name == name), None)


# ── Core logic ────────────────────────────────────────────────────────────────


def load_all_folders() -> list[InsertFolder]:
    """Return all temp-local-inserts* dirs, active folder first."""
    if not INSERTS_BASE.exists():
        return []
    active: Optional[InsertFolder] = None
    others: list[InsertFolder] = []
    for d in sorted(INSERTS_BASE.iterdir()):
        if not d.is_dir() or not d.name.startswith(INSERT_PREFIX):
            continue
        folder = InsertFolder(name=d.name, path=d)
        folder.load()
        if d.name == ACTIVE_FOLDER:
            active = folder
        else:
            others.append(folder)
    return ([active] if active else []) + others


def _record_history(from_folder: str, to_folder: str) -> None:
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    history: list[dict] = []
    if HISTORY_FILE.exists():
        try:
            history = json.loads(HISTORY_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            history = []
    history.append(
        {"ts": datetime.now().isoformat(timespec="seconds"), "from": from_folder, "to": to_folder}
    )
    HISTORY_FILE.write_text(json.dumps(history[-100:], indent=2))


def activate_folder(target: InsertFolder, save_current_as: Optional[str] = None) -> str:
    """
    Replace temp-local-inserts contents with target folder contents.
    Optionally saves current state as a named snapshot first.
    Raises ValueError on conflict. Returns a status message.
    """
    if target.is_active:
        return "Already the active folder."
    active_path = INSERTS_BASE / ACTIVE_FOLDER
    active_path.mkdir(parents=True, exist_ok=True)

    if save_current_as:
        # Sanitize name
        safe = save_current_as.strip().replace(" ", "-")
        snap_name = f"{INSERT_PREFIX}-{safe}"
        snap_path = INSERTS_BASE / snap_name
        if snap_path.exists():
            raise ValueError(f"Folder '{snap_name}' already exists")
        shutil.copytree(str(active_path), str(snap_path))

    for f in active_path.glob("*.json"):
        f.unlink()
    copied = 0
    for src in target.path.glob("*.json"):
        shutil.copy2(str(src), str(active_path / src.name))
        copied += 1
    _record_history(ACTIVE_FOLDER, target.name)

    msg = f"Activated '{target.name}' ({copied} file(s) copied)"
    if save_current_as:
        snap_name = f"{INSERT_PREFIX}-{save_current_as.strip().replace(' ', '-')}"
        msg += f" — previous state saved as '{snap_name}'"
    return msg


def create_snapshot(name: str) -> InsertFolder:
    """Copy temp-local-inserts to temp-local-inserts-<name>. Returns new folder."""
    safe = name.strip().replace(" ", "-")
    snap_name = f"{INSERT_PREFIX}-{safe}"
    snap_path = INSERTS_BASE / snap_name
    active_path = INSERTS_BASE / ACTIVE_FOLDER
    if snap_path.exists():
        raise ValueError(f"Folder '{snap_name}' already exists")
    if not active_path.exists():
        raise ValueError(f"Active folder '{ACTIVE_FOLDER}' does not exist")
    shutil.copytree(str(active_path), str(snap_path))
    folder = InsertFolder(name=snap_name, path=snap_path)
    folder.load()
    return folder


def delete_folder(folder: InsertFolder) -> str:
    """Permanently delete an inserts folder (must not be the active folder)."""
    if folder.is_active:
        raise ValueError("Cannot delete the active folder (temp-local-inserts)")
    if not folder.name.startswith(INSERT_PREFIX):
        raise ValueError(f"Refusing to delete '{folder.name}': not a temp-local-inserts folder")
    shutil.rmtree(str(folder.path))
    return f"Deleted '{folder.name}'"


def move_items(
    uuids: set[str],
    src: InsertFolder,
    dst: InsertFolder,
    type_name: str,
) -> tuple[int, str]:
    """
    Move items (by UUID) from src/type_name.json to dst/type_name.json.
    Both folders must start with INSERT_PREFIX.
    Returns (count_moved, message).
    """
    if not src.name.startswith(INSERT_PREFIX):
        raise ValueError(f"Source '{src.name}' is not a valid inserts folder")
    if not dst.name.startswith(INSERT_PREFIX):
        raise ValueError(f"Destination '{dst.name}' is not a valid inserts folder")

    src_file = src.path / f"{type_name}.json"
    dst_file = dst.path / f"{type_name}.json"

    src_all: list[dict] = []
    if src_file.exists():
        try:
            src_all = json.loads(src_file.read_text()) or []
        except (json.JSONDecodeError, OSError):
            pass

    dst_all: list[dict] = []
    if dst_file.exists():
        try:
            dst_all = json.loads(dst_file.read_text()) or []
        except (json.JSONDecodeError, OSError):
            pass

    to_move = [item for item in src_all if item.get("uuid") in uuids]
    remaining = [item for item in src_all if item.get("uuid") not in uuids]
    if not to_move:
        return 0, "No matching items found"

    dst_uuids = {item.get("uuid") for item in dst_all}
    new_items = [item for item in to_move if item.get("uuid") not in dst_uuids]
    skipped = len(to_move) - len(new_items)

    dst.path.mkdir(parents=True, exist_ok=True)
    src_file.write_text(json.dumps(remaining, indent=4))
    dst_file.write_text(json.dumps(dst_all + new_items, indent=4))

    msg = f"Moved {len(new_items)} item(s) → '{dst.name}/{type_name}.json'"
    if skipped:
        msg += f" ({skipped} duplicate(s) skipped)"
    return len(new_items), msg


def compute_diff(a: InsertFolder, b: InsertFolder) -> list[dict]:
    """Type-level diff between two folders."""
    all_types = sorted({t.name for t in a.types} | {t.name for t in b.types})
    rows = []
    for tn in all_types:
        ta = a.get_type(tn)
        tb = b.get_type(tn)
        ua = {i.uuid for i in (ta.items if ta else [])}
        ub = {i.uuid for i in (tb.items if tb else [])}
        rows.append(
            {
                "type": tn,
                "count_a": len(ua),
                "count_b": len(ub),
                "added": len(ub - ua),
                "removed": len(ua - ub),
                "same": len(ua & ub),
            }
        )
    return rows


# ── Modal: Activate ───────────────────────────────────────────────────────────


class ActivateModal(ModalScreen):
    """Confirm folder activation with optional pre-snapshot of current state."""

    DEFAULT_CSS = """
    ActivateModal { align: center middle; }
    ActivateModal > Vertical {
        background: $surface;
        border: thick $success;
        padding: 1 2;
        width: 66;
        height: auto;
    }
    ActivateModal #title { text-style: bold; color: $success; margin-bottom: 1; }
    ActivateModal .muted { color: $text-muted; }
    ActivateModal .hint { color: $warning; margin-top: 1; }
    ActivateModal #buttons { margin-top: 1; align-horizontal: right; }
    ActivateModal Button { margin-left: 1; }
    """

    def __init__(self, target: InsertFolder, current: InsertFolder):
        super().__init__()
        self.target = target
        self.current = current

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(f"Activate  {self.target.name}", id="title")
            yield Label(
                f"Current active: {self.current.name}  ({self.current.total_items} items)\n"
                f"Will be replaced with: {self.target.name}  ({self.target.total_items} items)",
                classes="muted",
            )
            yield Label(
                "Save current state as a snapshot first? (leave blank to skip):",
                classes="hint",
            )
            yield Input(placeholder="snapshot name, e.g.  my-work  or  2026-05-28", id="snap-input")
            with Horizontal(id="buttons"):
                yield Button("Cancel", variant="error", id="cancel")
                yield Button("Activate", variant="success", id="confirm")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "cancel":
            self.dismiss(None)
        elif event.button.id == "confirm":
            snap = self.query_one("#snap-input", Input).value.strip()
            self.dismiss({"save_as": snap or None})

    def on_key(self, event) -> None:  # type: ignore[override]
        if event.key == "escape":
            self.dismiss(None)


# ── Modal: Snapshot ───────────────────────────────────────────────────────────


class SnapshotModal(ModalScreen):
    """Create a named snapshot of the current temp-local-inserts."""

    DEFAULT_CSS = """
    SnapshotModal { align: center middle; }
    SnapshotModal > Vertical {
        background: $surface;
        border: thick $primary;
        padding: 1 2;
        width: 60;
        height: auto;
    }
    SnapshotModal #title { text-style: bold; color: $primary; margin-bottom: 1; }
    SnapshotModal .muted { color: $text-muted; margin-bottom: 1; }
    SnapshotModal #buttons { margin-top: 1; align-horizontal: right; }
    SnapshotModal Button { margin-left: 1; }
    """

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("New Snapshot", id="title")
            yield Label(
                "Creates a copy of temp-local-inserts as temp-local-inserts-<name>.\n"
                "The active folder is not changed.",
                classes="muted",
            )
            yield Input(
                placeholder="snapshot name, e.g.  staging  or  donor-test",
                id="name-input",
            )
            with Horizontal(id="buttons"):
                yield Button("Cancel", variant="error", id="cancel")
                yield Button("Create", variant="success", id="confirm")

    def _submit(self) -> None:
        name = self.query_one("#name-input", Input).value.strip()
        if name:
            self.dismiss(name)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "cancel":
            self.dismiss(None)
        elif event.button.id == "confirm":
            self._submit()

    def on_key(self, event) -> None:  # type: ignore[override]
        if event.key == "escape":
            self.dismiss(None)
        elif event.key == "enter":
            self._submit()


# ── Modal: Delete ─────────────────────────────────────────────────────────────


class DeleteModal(ModalScreen):
    """Confirm permanent deletion of a folder."""

    DEFAULT_CSS = """
    DeleteModal { align: center middle; }
    DeleteModal > Vertical {
        background: $surface;
        border: thick $error;
        padding: 1 2;
        width: 60;
        height: auto;
    }
    DeleteModal #title { text-style: bold; color: $error; margin-bottom: 1; }
    DeleteModal .warning { color: $warning; }
    DeleteModal #buttons { margin-top: 1; align-horizontal: right; }
    DeleteModal Button { margin-left: 1; }
    """

    def __init__(self, folder: InsertFolder):
        super().__init__()
        self.folder = folder

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(f"Delete  {self.folder.name}", id="title")
            yield Label(
                f"This will permanently delete the folder and all {self.folder.total_items} items in it.\n"
                "This cannot be undone.",
                classes="warning",
            )
            with Horizontal(id="buttons"):
                yield Button("Cancel", variant="primary", id="cancel")
                yield Button("Delete", variant="error", id="confirm")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "confirm")

    def on_key(self, event) -> None:  # type: ignore[override]
        if event.key == "escape":
            self.dismiss(False)


# ── Modal: Move Items ─────────────────────────────────────────────────────────


class MoveItemsModal(ModalScreen):
    """Pick a destination folder for the selected items."""

    DEFAULT_CSS = """
    MoveItemsModal { align: center middle; }
    MoveItemsModal > Vertical {
        background: $surface;
        border: thick $warning;
        padding: 1 2;
        width: 68;
        height: auto;
        max-height: 44;
    }
    MoveItemsModal #title { text-style: bold; color: $warning; margin-bottom: 1; }
    MoveItemsModal .section { color: $text-muted; margin-top: 1; }
    MoveItemsModal #item-scroll { height: 7; border: solid $panel; margin-bottom: 0; }
    MoveItemsModal #dest-list { height: 8; border: solid $panel; }
    MoveItemsModal #buttons { margin-top: 1; align-horizontal: right; }
    MoveItemsModal Button { margin-left: 1; }
    """

    def __init__(
        self,
        items: list[InsertItem],
        src: InsertFolder,
        destinations: list[InsertFolder],
        type_name: str,
    ):
        super().__init__()
        self._items = items
        self._src = src
        self._dsts = destinations
        self._type_name = type_name
        self._dst_idx = 0

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(
                f"Move {len(self._items)} item(s) from  {self._src.name}/{self._type_name}.json",
                id="title",
            )
            yield Label("Items to move:", classes="section")
            with VerticalScroll(id="item-scroll"):
                for item in self._items:
                    uid_short = (item.uuid[:16] + "…") if len(item.uuid) > 16 else item.uuid
                    yield Label(f"  {uid_short}   {item.display_id}")
            yield Label("Destination folder  (↑/↓ to choose):", classes="section")
            yield ListView(
                *[
                    ListItem(Label(f"  {f.name}   ({f.total_items} items)"))
                    for f in self._dsts
                ],
                id="dest-list",
            )
            with Horizontal(id="buttons"):
                yield Button("Cancel", variant="error", id="cancel")
                yield Button("Move", variant="warning", id="confirm")

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if event.list_view.id == "dest-list" and event.item is not None:
            lv = self.query_one("#dest-list", ListView)
            self._dst_idx = lv.index if lv.index is not None else 0

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "cancel":
            self.dismiss(None)
        elif event.button.id == "confirm":
            if self._dsts and 0 <= self._dst_idx < len(self._dsts):
                self.dismiss(self._dsts[self._dst_idx])
            else:
                self.dismiss(None)

    def on_key(self, event) -> None:  # type: ignore[override]
        if event.key == "escape":
            self.dismiss(None)
        elif event.key == "enter":
            dest_list = self.query_one("#dest-list", ListView)
            if dest_list.has_focus:
                # Enter on dest list selects and submits
                if self._dsts:
                    self.dismiss(self._dsts[self._dst_idx])
            # Enter on other elements handled by buttons


# ── Modal: Diff ───────────────────────────────────────────────────────────────


class DiffModal(ModalScreen):
    """Show type-level diff between two insert folders."""

    DEFAULT_CSS = """
    DiffModal { align: center middle; }
    DiffModal > Vertical {
        background: $surface;
        border: thick $accent;
        padding: 1 2;
        width: 82;
        height: auto;
        max-height: 40;
    }
    DiffModal #title { text-style: bold; color: $accent; margin-bottom: 1; }
    DiffModal #diff-table { height: auto; max-height: 30; }
    DiffModal #buttons { margin-top: 1; align-horizontal: right; }
    """

    def __init__(self, folder_a: InsertFolder, folder_b: InsertFolder):
        super().__init__()
        self._a = folder_a
        self._b = folder_b
        self._diff = compute_diff(folder_a, folder_b)

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(
                f"Diff   {self._a.name}   vs   {self._b.name}",
                id="title",
            )
            yield DataTable(id="diff-table", show_cursor=False)
            with Horizontal(id="buttons"):
                yield Button("Close", variant="primary", id="close")

    def on_mount(self) -> None:
        table = self.query_one("#diff-table", DataTable)
        table.add_columns(
            "Type", f"In {self._a.name[:16]}…", f"In {self._b.name[:16]}…",
            "+Added", "-Removed", "=Same",
        )
        for row in self._diff:
            added = f"+{row['added']}" if row["added"] else "—"
            removed = f"-{row['removed']}" if row["removed"] else "—"
            table.add_row(
                row["type"],
                str(row["count_a"]),
                str(row["count_b"]),
                added,
                removed,
                str(row["same"]),
            )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(None)

    def on_key(self, event) -> None:  # type: ignore[override]
        if event.key in ("escape", "q", "enter"):
            self.dismiss(None)


# ── Modal: Help ───────────────────────────────────────────────────────────────

_HELP_MD = """\
## SMaHT Inserts Manager — Keyboard Shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move cursor within the focused panel |
| `Tab` | Move focus: Folders → Types → Items |
| `Shift+Tab` | Move focus in reverse |

### Folder panel  (left column)

| Key | Action |
|-----|--------|
| `a` | **Activate** selected folder — replaces temp-local-inserts |
| `n` | **New snapshot** — copy temp-local-inserts to a named folder |
| `d` | **Diff** selected folder against temp-local-inserts |
| `Delete` | Delete selected folder (with confirmation) |

### Items panel  (bottom-right)

| Key | Action |
|-----|--------|
| `Space` | Toggle item selection (multi-select supported) |
| `m` | **Move** selected items to another folder |
| `ctrl+a` | Select **all** items in the current type |
| `Escape` | Clear all item selections |

### Global

| Key | Action |
|-----|--------|
| `r` | Refresh all folders from disk |
| `?` | Show / close this help |
| `q` | Quit |

---

All write operations (activate, snapshot, move, delete) are limited to
directories whose names start with **temp-local-inserts**.

Activation history is saved to `~/.smaht-im/activation-history.json`.
"""


class HelpModal(ModalScreen):
    DEFAULT_CSS = """
    HelpModal { align: center middle; }
    HelpModal > VerticalScroll {
        background: $surface;
        border: thick $primary;
        padding: 1 2;
        width: 74;
        height: 36;
    }
    """

    def compose(self) -> ComposeResult:
        with VerticalScroll():
            yield Markdown(_HELP_MD)

    def on_key(self, event) -> None:  # type: ignore[override]
        if event.key in ("escape", "q", "question_mark"):
            self.dismiss(None)


# ── Widgets ───────────────────────────────────────────────────────────────────


class FolderPanel(Static):
    """Left panel: list of all temp-local-inserts* folders."""

    class FolderChanged(Message):
        def __init__(self, folder: Optional[InsertFolder]) -> None:
            super().__init__()
            self.folder = folder

    def __init__(self) -> None:
        super().__init__()
        self._folders: list[InsertFolder] = []

    def compose(self) -> ComposeResult:
        yield ListView(id="folder-lv")

    def load(self, folders: list[InsertFolder]) -> None:
        self._folders = folders
        lv = self.query_one("#folder-lv", ListView)
        lv.clear()
        for folder in folders:
            name = folder.name
            count = folder.total_items
            if folder.is_active:
                label = Label(f" ● {name}  [{count}]")
            else:
                suffix = name[len(ACTIVE_FOLDER):]
                label = Label(f"   {ACTIVE_FOLDER}[dim]{suffix}[/dim]  [{count}]")
            lv.append(ListItem(label))
        if folders:
            lv.index = 0

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        lv = self.query_one("#folder-lv", ListView)
        idx = lv.index
        if idx is not None and 0 <= idx < len(self._folders):
            self.post_message(self.FolderChanged(self._folders[idx]))
        else:
            self.post_message(self.FolderChanged(None))

    @property
    def current_folder(self) -> Optional[InsertFolder]:
        lv = self.query_one("#folder-lv", ListView)
        idx = lv.index
        if idx is not None and 0 <= idx < len(self._folders):
            return self._folders[idx]
        return None

    @property
    def active_folder(self) -> Optional[InsertFolder]:
        return next((f for f in self._folders if f.is_active), None)

    def focus(self) -> "FolderPanel":  # type: ignore[override]
        self.query_one("#folder-lv", ListView).focus()
        return self


class TypePanel(Static):
    """Top-right panel: types (files) in the selected folder."""

    class TypeChanged(Message):
        def __init__(self, itype: Optional[InsertType]) -> None:
            super().__init__()
            self.itype = itype

    def __init__(self) -> None:
        super().__init__()
        self._types: list[InsertType] = []

    def compose(self) -> ComposeResult:
        yield ListView(id="type-lv")

    def load(self, folder: Optional[InsertFolder]) -> None:
        lv = self.query_one("#type-lv", ListView)
        lv.clear()
        self._types = folder.types if folder else []
        for t in self._types:
            lv.append(ListItem(Label(f"  {t.name}.json  [{t.count}]")))
        if self._types:
            lv.index = 0
            self.post_message(self.TypeChanged(self._types[0]))
        else:
            self.post_message(self.TypeChanged(None))

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        lv = self.query_one("#type-lv", ListView)
        idx = lv.index
        if idx is not None and 0 <= idx < len(self._types):
            self.post_message(self.TypeChanged(self._types[idx]))
        else:
            self.post_message(self.TypeChanged(None))

    @property
    def current_type(self) -> Optional[InsertType]:
        lv = self.query_one("#type-lv", ListView)
        idx = lv.index
        if idx is not None and 0 <= idx < len(self._types):
            return self._types[idx]
        return None

    def focus(self) -> "TypePanel":  # type: ignore[override]
        self.query_one("#type-lv", ListView).focus()
        return self


class ItemsPanel(Static):
    """Bottom-right panel: items in selected type with multi-select."""

    def __init__(self) -> None:
        super().__init__()
        self._items: list[InsertItem] = []
        self._selected: set[str] = set()

    def compose(self) -> ComposeResult:
        yield DataTable(id="items-dt", show_cursor=True)

    def on_mount(self) -> None:
        dt = self.query_one("#items-dt", DataTable)
        dt.cursor_type = "row"
        dt.add_columns("✓", "UUID", "ID / Accession", "Status")

    def load(self, itype: Optional[InsertType]) -> None:
        self._items = itype.items if itype else []
        self._selected = set()
        self._rebuild_table()

    def _rebuild_table(self) -> None:
        dt = self.query_one("#items-dt", DataTable)
        dt.clear()
        for item in self._items:
            uid_short = (item.uuid[:18] + "…") if len(item.uuid) > 18 else item.uuid
            sel = "●" if item.uuid in self._selected else " "
            dt.add_row(sel, uid_short, item.display_id[:34], item.status[:16], key=item.uuid)

    def toggle_current(self) -> None:
        dt = self.query_one("#items-dt", DataTable)
        if not self._items:
            return
        row_idx = dt.cursor_row
        if 0 <= row_idx < len(self._items):
            item = self._items[row_idx]
            if item.uuid in self._selected:
                self._selected.discard(item.uuid)
            else:
                self._selected.add(item.uuid)
            sel = "●" if item.uuid in self._selected else " "
            dt.update_cell_at(Coordinate(row_idx, 0), sel)

    def select_all(self) -> None:
        self._selected = {item.uuid for item in self._items}
        self._rebuild_table()

    def clear_selection(self) -> None:
        self._selected = set()
        self._rebuild_table()

    @property
    def selected_items(self) -> list[InsertItem]:
        return [item for item in self._items if item.uuid in self._selected]

    @property
    def selected_uuids(self) -> set[str]:
        return set(self._selected)

    def focus(self) -> "ItemsPanel":  # type: ignore[override]
        self.query_one("#items-dt", DataTable).focus()
        return self


# ── Main App ──────────────────────────────────────────────────────────────────


class InsertsManagerApp(App):
    """SMaHT Inserts Manager — lazygit-style TUI."""

    TITLE = "SMaHT Inserts Manager"
    SUB_TITLE = f"inserts → {INSERTS_BASE}"

    CSS = """
    Screen {
        layout: vertical;
    }

    #main-row {
        layout: horizontal;
        height: 1fr;
    }

    FolderPanel {
        width: 36;
        min-width: 28;
        border: solid $primary;
        border-title-color: $primary;
        height: 100%;
        padding: 0;
    }

    FolderPanel:focus-within {
        border: solid $success;
        border-title-color: $success;
    }

    #folder-lv {
        height: 100%;
        background: transparent;
    }

    #right-col {
        layout: vertical;
        width: 1fr;
        height: 100%;
    }

    TypePanel {
        height: 1fr;
        border: solid $primary;
        border-title-color: $primary;
        padding: 0;
    }

    TypePanel:focus-within {
        border: solid $success;
        border-title-color: $success;
    }

    #type-lv {
        height: 100%;
        background: transparent;
    }

    ItemsPanel {
        height: 2fr;
        border: solid $primary;
        border-title-color: $primary;
        padding: 0;
    }

    ItemsPanel:focus-within {
        border: solid $success;
        border-title-color: $success;
    }

    #items-dt {
        height: 100%;
        background: transparent;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("question_mark", "help", "Help", key_display="?"),
        Binding("r", "refresh", "Refresh"),
        Binding("a", "activate", "Activate"),
        Binding("n", "snapshot", "New Snap"),
        Binding("m", "move_items", "Move"),
        Binding("d", "diff", "Diff"),
        Binding("delete", "delete_folder", "Delete"),
        Binding("tab", "focus_next", "Next Panel", show=False),
        Binding("shift+tab", "focus_previous", "Prev Panel", show=False),
        Binding("space", "toggle_item", "Select Item", show=False),
        Binding("ctrl+a", "select_all", "Select All", show=False),
        Binding("escape", "clear_selection", "Clear Selection", show=False),
    ]

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="main-row"):
            yield FolderPanel()
            with Vertical(id="right-col"):
                yield TypePanel()
                yield ItemsPanel()
        yield Footer()

    def on_mount(self) -> None:
        self._load_folders()
        fp = self.query_one(FolderPanel)
        fp.border_title = "Folders"
        self.query_one(TypePanel).border_title = "Types"
        self.query_one(ItemsPanel).border_title = "Items  (Space=select  m=move  ctrl+a=all  Esc=clear)"
        fp.focus()

    def _load_folders(self) -> None:
        folders = load_all_folders()
        fp = self.query_one(FolderPanel)
        fp.load(folders)
        if not folders:
            self.notify(f"No temp-local-inserts* folders found in {INSERTS_BASE}", severity="warning")

    # ── Folder panel messages ─────────────────────────────────────────────────

    def on_folder_panel_folder_changed(self, event: FolderPanel.FolderChanged) -> None:
        folder = event.folder
        tp = self.query_one(TypePanel)
        tp.border_title = f"Types  in  {folder.name}" if folder else "Types"
        tp.load(folder)

    def on_type_panel_type_changed(self, event: TypePanel.TypeChanged) -> None:
        itype = event.itype
        ip = self.query_one(ItemsPanel)
        ip.border_title = (
            f"Items  in  {itype.name}.json  ({itype.count})"
            "  |  Space=select  m=move  ctrl+a=all  Esc=clear"
            if itype
            else "Items"
        )
        ip.load(itype)

    # ── Focus management ──────────────────────────────────────────────────────

    def action_focus_next(self) -> None:
        fp = self.query_one(FolderPanel)
        tp = self.query_one(TypePanel)
        ip = self.query_one(ItemsPanel)
        if self._panel_has_focus(fp):
            tp.focus()
        elif self._panel_has_focus(tp):
            ip.focus()
        else:
            fp.focus()

    def action_focus_previous(self) -> None:
        fp = self.query_one(FolderPanel)
        tp = self.query_one(TypePanel)
        ip = self.query_one(ItemsPanel)
        if self._panel_has_focus(ip):
            tp.focus()
        elif self._panel_has_focus(tp):
            fp.focus()
        else:
            ip.focus()

    @staticmethod
    def _panel_has_focus(panel: Static) -> bool:
        focused = panel.app.focused
        return focused is not None and (focused is panel or panel in focused.ancestors)

    # ── Action: refresh ───────────────────────────────────────────────────────

    def action_refresh(self) -> None:
        fp = self.query_one(FolderPanel)
        old_folder = fp.current_folder
        self._load_folders()
        self.notify("Reloaded from disk", timeout=2)

    # ── Action: help ──────────────────────────────────────────────────────────

    def action_help(self) -> None:
        self.push_screen(HelpModal())

    # ── Action: activate ─────────────────────────────────────────────────────

    def action_activate(self) -> None:
        fp = self.query_one(FolderPanel)
        target = fp.current_folder
        if not target:
            self.notify("No folder selected", severity="warning")
            return
        if target.is_active:
            self.notify("Already the active folder", severity="information")
            return
        current = fp.active_folder
        if not current:
            self.notify("Active folder (temp-local-inserts) not found", severity="error")
            return
        self.push_screen(ActivateModal(target, current), self._on_activate_result)

    def _on_activate_result(self, result: Optional[dict]) -> None:
        if result is None:
            return
        fp = self.query_one(FolderPanel)
        target = fp.current_folder
        if not target:
            return
        try:
            msg = activate_folder(target, save_current_as=result.get("save_as"))
            self._load_folders()
            self.notify(msg, timeout=5)
        except ValueError as e:
            self.notify(str(e), severity="error", timeout=6)

    # ── Action: snapshot ──────────────────────────────────────────────────────

    def action_snapshot(self) -> None:
        self.push_screen(SnapshotModal(), self._on_snapshot_result)

    def _on_snapshot_result(self, name: Optional[str]) -> None:
        if not name:
            return
        try:
            folder = create_snapshot(name)
            self._load_folders()
            self.notify(f"Snapshot created: '{folder.name}'", timeout=4)
        except ValueError as e:
            self.notify(str(e), severity="error", timeout=6)

    # ── Action: delete folder ─────────────────────────────────────────────────

    def action_delete_folder(self) -> None:
        fp = self.query_one(FolderPanel)
        folder = fp.current_folder
        if not folder:
            self.notify("No folder selected", severity="warning")
            return
        if folder.is_active:
            self.notify("Cannot delete the active folder", severity="error")
            return
        self.push_screen(DeleteModal(folder), self._on_delete_result)

    def _on_delete_result(self, confirmed: bool) -> None:
        if not confirmed:
            return
        fp = self.query_one(FolderPanel)
        folder = fp.current_folder
        if not folder:
            return
        try:
            msg = delete_folder(folder)
            self._load_folders()
            self.notify(msg, timeout=4)
        except ValueError as e:
            self.notify(str(e), severity="error", timeout=6)

    # ── Action: diff ──────────────────────────────────────────────────────────

    def action_diff(self) -> None:
        fp = self.query_one(FolderPanel)
        selected = fp.current_folder
        active = fp.active_folder
        if not selected:
            self.notify("No folder selected", severity="warning")
            return
        if not active:
            self.notify("Active folder (temp-local-inserts) not found", severity="error")
            return
        if selected.is_active:
            self.notify("Select a non-active folder to diff against the active one", severity="information")
            return
        self.push_screen(DiffModal(active, selected))

    # ── Action: move items ────────────────────────────────────────────────────

    def action_move_items(self) -> None:
        fp = self.query_one(FolderPanel)
        tp = self.query_one(TypePanel)
        ip = self.query_one(ItemsPanel)

        src_folder = fp.current_folder
        current_type = tp.current_type
        selected = ip.selected_items

        if not src_folder:
            self.notify("No folder selected in Folders panel", severity="warning")
            return
        if not current_type:
            self.notify("No type selected in Types panel", severity="warning")
            return
        if not selected:
            self.notify("No items selected — use Space to select items in the Items panel", severity="warning")
            return

        # Build destination list (all folders except the source)
        all_folders = fp._folders
        dsts = [f for f in all_folders if f.name != src_folder.name]
        if not dsts:
            self.notify("No other folders available as destinations", severity="warning")
            return

        self.push_screen(
            MoveItemsModal(selected, src_folder, dsts, current_type.name),
            self._on_move_result,
        )

    def _on_move_result(self, dst: Optional[InsertFolder]) -> None:
        if dst is None:
            return
        fp = self.query_one(FolderPanel)
        tp = self.query_one(TypePanel)
        ip = self.query_one(ItemsPanel)

        src = fp.current_folder
        itype = tp.current_type
        if not src or not itype:
            return

        try:
            count, msg = move_items(ip.selected_uuids, src, dst, itype.name)
            self._load_folders()
            self.notify(msg, timeout=5)
        except ValueError as e:
            self.notify(str(e), severity="error", timeout=6)

    # ── Action: item selection ────────────────────────────────────────────────

    def action_toggle_item(self) -> None:
        ip = self.query_one(ItemsPanel)
        if self._panel_has_focus(ip):
            ip.toggle_current()

    def action_select_all(self) -> None:
        ip = self.query_one(ItemsPanel)
        ip.select_all()
        n = len(ip.selected_items)
        self.notify(f"Selected all {n} items", timeout=2)

    def action_clear_selection(self) -> None:
        ip = self.query_one(ItemsPanel)
        ip.clear_selection()


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    if not INSERTS_BASE.exists():
        print(f"\nError: inserts directory not found:\n  {INSERTS_BASE}\n")
        print("Set SMAHT_REPO_ROOT to the root of your smaht-portal checkout.")
        sys.exit(1)
    app = InsertsManagerApp()
    app.run()


if __name__ == "__main__":
    main()
