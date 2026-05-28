#!/usr/bin/env python3
"""
im — SMaHT inserts manager

A local CLI for pulling, organizing, and tracking portal inserts during development.
Wraps update-inserts-from-server with a manifest layer and richer query support.

Setup:
    pip install click          # only external dependency
    chmod +x ~/smaht-im/im.py
    # Add an alias to your shell profile:
    #   alias im='python ~/smaht-im/im.py'

Requirements:
    - Activate the smaht virtualenv before use (update-inserts-from-server must be on PATH)
    - ~/.smaht-keys.json must exist with your portal credentials

Manifest storage:
    ~/.smaht-im/{workspace}.json   (never inside the repo)
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import click

# ── Configuration ─────────────────────────────────────────────────────────────

REPO_ROOT = Path(
    os.environ.get(
        "SMAHT_REPO_ROOT",
        str(Path.home() / "dbmi" / "smaht-portal"),
    )
)
INSERTS_BASE = REPO_ROOT / "src" / "encoded" / "tests" / "data"
MANIFEST_DIR = Path.home() / ".smaht-im"
KEYS_FILE = Path.home() / ".smaht-keys.json"
DEFAULT_DEST = "temp-local-inserts"
DEFAULT_ENV = "data"
DEFAULT_PORTAL = "smaht"

# ── Name conversion helpers ───────────────────────────────────────────────────

def to_pascal(name: str) -> str:
    """donor → Donor, output_file → OutputFile, FileFastq → FileFastq"""
    if "_" in name:
        return "".join(w.capitalize() for w in name.split("_"))
    return name[0].upper() + name[1:] if name else name


def to_snake(name: str) -> str:
    """OutputFile → output_file, Donor → donor, donor → donor"""
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    return s.lower()


# ── Manifest helpers ──────────────────────────────────────────────────────────

def manifest_path(dest: str) -> Path:
    return MANIFEST_DIR / f"{dest}.json"


def load_manifest(dest: str) -> dict:
    p = manifest_path(dest)
    if p.exists():
        return json.loads(p.read_text())
    return {"dest": dest, "env": DEFAULT_ENV, "types": {}}


def save_manifest(dest: str, data: dict) -> None:
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path(dest).write_text(json.dumps(data, indent=2, sort_keys=True))


def refresh_counts(dest: str, manifest: dict) -> None:
    """Re-read every .json in the inserts dir and update count fields."""
    for item_type, items in read_inserts_dir(dest).items():
        manifest.setdefault("types", {}).setdefault(item_type, {})["count"] = len(items)


# ── Insert directory helpers ──────────────────────────────────────────────────

def read_inserts_dir(dest: str) -> dict:
    """Returns {snake_type: [items]} for all .json files in the directory."""
    d = INSERTS_BASE / dest
    if not d.exists():
        return {}
    result = {}
    for f in sorted(d.glob("*.json")):
        try:
            items = json.loads(f.read_text())
            result[f.stem] = items if isinstance(items, list) else []
        except json.JSONDecodeError:
            result[f.stem] = []
    return result


# ── Portal auth helpers ───────────────────────────────────────────────────────

def get_auth_key(env: str) -> dict:
    """Load auth key dict from ~/.smaht-keys.json for the given env."""
    if not KEYS_FILE.exists():
        raise click.ClickException(
            f"Keys file not found: {KEYS_FILE}\n"
            'Expected: {"env": {"key": "...", "secret": "...", "server": "https://..."}}'
        )
    keys = json.loads(KEYS_FILE.read_text())
    if env not in keys:
        avail = ", ".join(keys.keys())
        raise click.ClickException(f"No entry for env '{env}' in {KEYS_FILE}. Available: {avail}")
    return keys[env]


def portal_search(auth: dict, query: str, fields: Optional[list] = None) -> list:
    """
    Run a /search/ against the portal and return all @graph items.
    Uses basic auth with key/secret from the auth dict.
    """
    try:
        import requests as req
    except ImportError:
        raise click.ClickException("'requests' not installed. Run: pip install requests")

    server = auth["server"].rstrip("/")
    params = query + "&limit=all"
    if fields:
        params += "".join(f"&field={f}" for f in fields)

    url = f"{server}/search/?{params}"
    response = req.get(url, auth=(auth["key"], auth["secret"]), timeout=60)
    response.raise_for_status()
    return response.json().get("@graph", [])


# ── Utilities ─────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def run_update_inserts(dest: str, env: str, search_query: str, refresh: bool = False) -> bool:
    """Shell out to update-inserts-from-server. Returns True on success."""
    cmd = [
        "update-inserts-from-server",
        "--dest", dest,
        "--env", env,
        "--portal", DEFAULT_PORTAL,
        "--search", search_query,
    ]
    if refresh:
        cmd.append("--refresh")

    click.echo(f"  $ {' '.join(cmd)}")
    click.echo()
    result = subprocess.run(cmd)
    return result.returncode == 0


# ── CLI group ─────────────────────────────────────────────────────────────────

@click.group()
@click.version_option("0.1.0")
def cli():
    """SMaHT inserts manager — pull, track, and diff portal inserts."""


# ── status ────────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--dir", "dest", default=DEFAULT_DEST, show_default=True,
              help="Inserts workspace directory name")
@click.option("--all", "show_all", is_flag=True,
              help="Show status for every tracked workspace")
def status(dest: str, show_all: bool):
    """Show local inserts: item counts, last-pulled date, and saved queries."""
    dests = [m.stem for m in sorted(MANIFEST_DIR.glob("*.json"))] if show_all else [dest]

    for d in dests:
        local = read_inserts_dir(d)
        manifest = load_manifest(d)
        full_path = INSERTS_BASE / d

        click.echo()
        header = click.style(d, bold=True, fg="cyan")
        click.echo(f"  {header}  ({full_path})")

        if not full_path.exists():
            click.echo(click.style("  Directory does not exist", fg="red"))
            continue
        if not local:
            click.echo("  (empty — no .json files found)")
            continue

        click.echo(f"  {'Type':<36}  {'Items':>5}  {'Last Pulled':<12}  Query")
        click.echo(f"  {'-'*36}  {'-----':>5}  {'-'*12}  {'-'*40}")

        total = 0
        for item_type in sorted(local):
            items = local[item_type]
            count = len(items)
            total += count
            meta = manifest.get("types", {}).get(item_type, {})
            pulled = (meta.get("last_pulled") or "")[:10] or "—"
            query = meta.get("query", "")
            query_display = (query[:38] + "...") if len(query) > 41 else (query or "—")
            count_color = "yellow" if count == 0 else "green"
            click.echo(
                f"  {item_type:<36}  {click.style(f'{count:>5}', fg=count_color)}"
                f"  {pulled:<12}  {query_display}"
            )

        env = manifest.get("env", DEFAULT_ENV)
        click.echo(f"\n  {total} items across {len(local)} types  [env: {env}]")

    click.echo()


# ── pull ──────────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--dir", "dest", default=DEFAULT_DEST, show_default=True,
              help="Destination workspace directory name")
@click.option("--env", default=DEFAULT_ENV, show_default=True,
              help="Portal environment (key in ~/.smaht-keys.json)")
@click.option("--type", "types", multiple=True, metavar="TYPE",
              help="Item type to pull — repeatable (e.g. --type Donor --type Sample)")
@click.option("--uuid", "uuids", multiple=True, metavar="UUID",
              help="Specific UUID to pull — repeatable")
@click.option("--uuid-file", type=click.Path(exists=True), metavar="FILE",
              help="Text file with one UUID per line")
@click.option("--search", "extra_filter", metavar="QUERY",
              help="Extra portal search params appended to each --type query "
                   "(e.g. 'status=released&data_category=Genome')")
@click.option("--refresh", is_flag=True,
              help="Replace existing data instead of merging")
def pull(dest, env, types, uuids, uuid_file, extra_filter, refresh):
    """
    Pull inserts from the portal into a workspace directory.

    Each --type fires one search query; --uuid / --uuid-file are batched.
    Queries and pull timestamps are saved to the manifest for later repull.

    \b
    Examples:
      im pull --type Donor --type Sample
      im pull --type OutputFile --search "status=released"
      im pull --uuid-file my-uuids.txt
      im pull --type Donor --env wolf
    """
    manifest = load_manifest(dest)
    manifest["env"] = env

    # Collect all UUIDs
    all_uuids = list(uuids)
    if uuid_file:
        lines = Path(uuid_file).read_text().splitlines()
        all_uuids.extend(line.strip() for line in lines if line.strip() and not line.startswith("#"))

    # Build list of (search_query_string, display_label, [snake_types_to_record])
    runs: list[tuple[str, str, list[str]]] = []

    if all_uuids:
        batch_size = 80  # stay under URL length limits
        for i in range(0, len(all_uuids), batch_size):
            batch = all_uuids[i : i + batch_size]
            q = "&".join(f"uuid={u}" for u in batch)
            label = f"{len(batch)} UUID(s)"
            if len(all_uuids) > batch_size:
                label += f" (batch {i // batch_size + 1})"
            runs.append((q, label, []))

    if types:
        for t in types:
            portal_type = to_pascal(t)
            snake_type = to_snake(t)
            q = f"type={portal_type}"
            if extra_filter:
                q += f"&{extra_filter.lstrip('&')}"
            runs.append((q, q, [snake_type]))
    elif extra_filter and not all_uuids:
        runs.append((extra_filter, extra_filter, []))

    if not runs:
        raise click.UsageError(
            "Nothing to pull. Provide at least one of: --type, --uuid, --uuid-file, --search"
        )

    # Ensure destination directory exists
    dest_dir = INSERTS_BASE / dest
    if not dest_dir.exists():
        click.echo(f"  Creating: {dest_dir}")
        dest_dir.mkdir(parents=True)

    ts = now_iso()
    for query, label, snake_types in runs:
        click.echo(f"\n  Pulling: {click.style(label, fg='cyan')}")
        success = run_update_inserts(dest, env, query, refresh)

        if success:
            for snake_type in snake_types:
                manifest.setdefault("types", {})[snake_type] = {
                    "env": env,
                    "last_pulled": ts,
                    "query": query,
                    "count": 0,  # updated below
                }
        else:
            click.echo(click.style(f"  Pull failed for: {label}", fg="red"), err=True)

    refresh_counts(dest, manifest)
    save_manifest(dest, manifest)
    click.echo(f"\n  Manifest saved → {manifest_path(dest)}\n")


# ── repull ────────────────────────────────────────────────────────────────────

@cli.command()
@click.argument("types", nargs=-1, metavar="[TYPE]...")
@click.option("--dir", "dest", default=DEFAULT_DEST, show_default=True)
@click.option("--env", default=None, help="Override the saved env")
@click.option("--all", "repull_all", is_flag=True, help="Repull every type in the manifest")
@click.option("--stale", metavar="DAYS", type=int,
              help="Only repull types not pulled in the last N days")
@click.option("--refresh", is_flag=True, help="Replace instead of merge")
def repull(types, dest, env, repull_all, stale, refresh):
    """
    Re-run the saved query for one or more types.

    \b
    Examples:
      im repull donor
      im repull donor output_file
      im repull --all
      im repull --stale 7
    """
    manifest = load_manifest(dest)
    effective_env = env or manifest.get("env", DEFAULT_ENV)
    type_data = manifest.get("types", {})

    # Determine candidate set
    if repull_all or not types:
        candidates = set(type_data.keys())
    else:
        candidates = {to_snake(t) for t in types}

    if stale:
        cutoff = datetime.now().timestamp() - stale * 86400
        candidates = {
            t for t in candidates
            if not type_data.get(t, {}).get("last_pulled")
            or datetime.fromisoformat(type_data[t]["last_pulled"]).timestamp() < cutoff
        }

    to_run = {t: type_data[t] for t in candidates if t in type_data and type_data[t].get("query")}
    no_query = candidates - set(to_run.keys())

    if no_query:
        click.echo(
            click.style(f"  No saved query for: {', '.join(sorted(no_query))}", fg="yellow"),
            err=True,
        )
    if not to_run:
        click.echo("  Nothing to repull.")
        return

    for item_type, info in sorted(to_run.items()):
        query = info["query"]
        click.echo(f"\n  Repulling {click.style(item_type, fg='cyan')}  [{query}]")
        success = run_update_inserts(dest, effective_env, query, refresh)

        if success:
            info["last_pulled"] = now_iso()
            info["env"] = effective_env

    refresh_counts(dest, manifest)
    save_manifest(dest, manifest)
    click.echo(f"\n  Manifest updated → {manifest_path(dest)}\n")


# ── coverage ──────────────────────────────────────────────────────────────────

@cli.command()
@click.option("--dir", "dest", default=DEFAULT_DEST, show_default=True)
@click.option("--env", default=DEFAULT_ENV, show_default=True)
@click.option("--type", "types", multiple=True, metavar="TYPE",
              help="Limit check to specific types (default: all local types)")
@click.option("--show-missing", is_flag=True,
              help="List missing UUIDs below the table")
def coverage(dest, env, types, show_missing):
    """
    Compare local inserts against what is available on the portal.

    Queries the portal for all UUIDs of each type and diffs against local files.
    Requires internet access and valid credentials in ~/.smaht-keys.json.
    """
    local = read_inserts_dir(dest)
    check_types = [to_snake(t) for t in types] if types else sorted(local.keys())

    if not check_types:
        raise click.ClickException(
            "No local types found and none specified with --type. "
            "Pull something first, or pass --type explicitly."
        )

    auth = get_auth_key(env)
    server = auth["server"]

    click.echo()
    click.echo(
        f"  Coverage: {click.style(dest, fg='cyan')} "
        f"vs {click.style(env, fg='yellow')} ({server})"
    )
    click.echo()
    click.echo(f"  {'Type':<36}  {'Local':>6}  {'Remote':>6}  {'Missing':>7}  Status")
    click.echo(f"  {'-'*36}  {'------':>6}  {'------':>6}  {'-------':>7}  ------")

    missing_details: dict[str, list[dict]] = {}

    for item_type in sorted(check_types):
        local_items = local.get(item_type, [])
        local_uuids = {item["uuid"] for item in local_items if item.get("uuid")}

        try:
            portal_type = to_pascal(item_type)
            remote_items = portal_search(
                auth,
                f"type={portal_type}",
                fields=["uuid", "accession", "identifier", "title"],
            )
            remote_uuids = {item["uuid"] for item in remote_items if item.get("uuid")}

            missing = remote_uuids - local_uuids
            extra = local_uuids - remote_uuids

            lc, rc, mc = len(local_uuids), len(remote_uuids), len(missing)

            if mc == 0 and not extra:
                status_str = click.style("complete", fg="green")
            elif mc == 0:
                status_str = click.style(f"+{len(extra)} local-only", fg="yellow")
            else:
                pct = int(100 * lc / rc) if rc else 0
                color = "green" if pct >= 80 else ("yellow" if pct >= 40 else "red")
                status_str = click.style(f"{pct}% local", fg=color)

            missing_str = str(mc) if mc > 0 else "—"
            click.echo(
                f"  {item_type:<36}  {lc:>6}  {rc:>6}  {missing_str:>7}  {status_str}"
            )

            if show_missing and missing:
                uuid_to_label = {}
                for item in remote_items:
                    uid = item.get("uuid")
                    if uid:
                        label = (
                            item.get("accession")
                            or item.get("identifier")
                            or item.get("title")
                            or ""
                        )
                        uuid_to_label[uid] = label
                missing_details[item_type] = [
                    {"uuid": u, "label": uuid_to_label.get(u, "")}
                    for u in sorted(missing)
                ]

        except Exception as e:
            click.echo(
                f"  {item_type:<36}  {len(local_items):>6}  {'ERR':>6}  {'—':>7}  "
                f"{click.style(str(e)[:45], fg='red')}",
                err=True,
            )

    click.echo()

    if show_missing and missing_details:
        click.echo("  Missing items:\n")
        for item_type, items in sorted(missing_details.items()):
            click.echo(f"  {click.style(item_type, bold=True)}  ({len(items)} missing)")
            for item in items:
                label = f"  [{item['label']}]" if item["label"] else ""
                click.echo(f"    {item['uuid']}{label}")
        click.echo()


# ── workspaces ────────────────────────────────────────────────────────────────

@cli.command()
def workspaces():
    """List all tracked insert workspaces (one per manifest file in ~/.smaht-im/)."""
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    manifests = sorted(MANIFEST_DIR.glob("*.json"))

    if not manifests:
        click.echo("\n  No workspaces tracked yet. Run 'im pull' to create one.\n")
        return

    click.echo()
    click.echo(
        f"  {'Workspace':<32}  {'Types':>5}  {'Items':>6}  {'Env':<10}  Last Activity"
    )
    click.echo(
        f"  {'-'*32}  {'-----':>5}  {'------':>6}  {'----------':<10}  {'-'*10}"
    )

    any_missing = False
    for mp in manifests:
        data = json.loads(mp.read_text())
        dest = data.get("dest", mp.stem)
        types = data.get("types", {})
        total = sum(v.get("count", 0) for v in types.values())
        env = data.get("env", "—")
        dates = [v["last_pulled"] for v in types.values() if v.get("last_pulled")]
        last = max(dates)[:10] if dates else "—"
        exists = (INSERTS_BASE / dest).exists()

        if not exists:
            flag = click.style("! ", fg="red")
            any_missing = True
        else:
            flag = "  "

        click.echo(f"  {flag}{dest:<30}  {len(types):>5}  {total:>6}  {env:<10}  {last}")

    click.echo(f"\n  Manifests: {MANIFEST_DIR}")
    click.echo(f"  Inserts:   {INSERTS_BASE}")
    if any_missing:
        click.echo(click.style("  ! = directory no longer exists on disk", fg="red"))
    click.echo()


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli()
