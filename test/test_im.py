"""
Tests for im.py's pure helpers: name conversion and manifest read/write.

im.py resolves MANIFEST_DIR/INSERTS_BASE/KEYS_FILE from HOME/SMAHT_REPO_ROOT
into module-level names at IMPORT time (same pattern as src/core.js — see
test/helpers/env.js for the JS side of this). Unlike ESM imports, Python's
`import` isn't hoisted, so setting the env vars before `import im` below is
enough to isolate this whole file to a throwaway temp HOME — it never reads
or writes a real ~/.smaht-im or a real smaht-portal checkout, which matters
doubly here since real pulled inserts data may be protected (see CLAUDE.md's
"Data safety" section).

Only pure/deterministic helpers are covered — not the Click CLI commands
(status/pull/repull/coverage/workspaces), which need real portal credentials
or a real update-inserts-from-server on PATH and aren't covered yet.

Run with: npm run test:py  (or: python3 -m unittest discover -s test -v)
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_TMP_HOME = tempfile.mkdtemp(prefix="imc-test-home-")
_TMP_REPO_ROOT = tempfile.mkdtemp(prefix="imc-test-repo-")
os.environ["HOME"] = _TMP_HOME
os.environ["SMAHT_REPO_ROOT"] = _TMP_REPO_ROOT

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import im  # noqa: E402  (must come after the env vars above are set)


class NameConversionTests(unittest.TestCase):
    def test_to_pascal(self):
        self.assertEqual(im.to_pascal("donor"), "Donor")
        self.assertEqual(im.to_pascal("output_file"), "OutputFile")
        self.assertEqual(im.to_pascal("FileFastq"), "FileFastq")
        self.assertEqual(im.to_pascal(""), "")

    def test_to_snake(self):
        self.assertEqual(im.to_snake("OutputFile"), "output_file")
        self.assertEqual(im.to_snake("Donor"), "donor")
        self.assertEqual(im.to_snake("donor"), "donor")
        self.assertEqual(im.to_snake("FileFastq"), "file_fastq")

    def test_round_trip_is_stable_for_simple_names(self):
        for name in ["donor", "tissue_sample", "submission_center"]:
            self.assertEqual(im.to_snake(im.to_pascal(name)), name)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        # Each test gets a clean manifest dir so tests can't see each other's writes.
        shutil.rmtree(im.MANIFEST_DIR, ignore_errors=True)

    def test_load_manifest_returns_default_shape_when_missing(self):
        manifest = im.load_manifest("temp-local-inserts-nope")
        self.assertEqual(manifest, {"dest": "temp-local-inserts-nope", "env": im.DEFAULT_ENV, "types": {}})

    def test_save_then_load_round_trips(self):
        data = {"dest": "temp-local-inserts-x", "env": "data", "types": {"Donor": {"count": 3}}}
        im.save_manifest("temp-local-inserts-x", data)
        self.assertEqual(im.load_manifest("temp-local-inserts-x"), data)

    def test_manifest_path_is_under_manifest_dir(self):
        p = im.manifest_path("temp-local-inserts-y")
        self.assertEqual(p, im.MANIFEST_DIR / "temp-local-inserts-y.json")

    def test_manifest_never_written_inside_the_repo_checkout(self):
        # Regression guard for the "manifest storage: never inside the repo"
        # invariant documented in im.py's own module docstring.
        p = im.manifest_path("temp-local-inserts-z")
        self.assertFalse(str(p).startswith(str(im.INSERTS_BASE)))


class ReadInsertsDirTests(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(im.INSERTS_BASE, ignore_errors=True)
        im.INSERTS_BASE.mkdir(parents=True, exist_ok=True)

    def test_returns_empty_dict_for_a_missing_directory(self):
        self.assertEqual(im.read_inserts_dir("temp-local-inserts-missing"), {})

    def test_reads_json_files_into_type_keyed_lists(self):
        d = im.INSERTS_BASE / "temp-local-inserts-read"
        d.mkdir(parents=True)
        (d / "donor.json").write_text(json.dumps([{"uuid": "u1"}]))
        (d / "tissue.json").write_text(json.dumps([{"uuid": "u2"}, {"uuid": "u3"}]))
        result = im.read_inserts_dir("temp-local-inserts-read")
        self.assertEqual(result["donor"], [{"uuid": "u1"}])
        self.assertEqual(len(result["tissue"]), 2)

    def test_non_list_json_becomes_an_empty_list(self):
        d = im.INSERTS_BASE / "temp-local-inserts-notlist"
        d.mkdir(parents=True)
        (d / "donor.json").write_text(json.dumps({"not": "a list"}))
        result = im.read_inserts_dir("temp-local-inserts-notlist")
        self.assertEqual(result["donor"], [])

    def test_malformed_json_becomes_an_empty_list_rather_than_raising(self):
        d = im.INSERTS_BASE / "temp-local-inserts-broken"
        d.mkdir(parents=True)
        (d / "donor.json").write_text("{not valid json")
        result = im.read_inserts_dir("temp-local-inserts-broken")
        self.assertEqual(result["donor"], [])


class RefreshCountsTests(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(im.INSERTS_BASE, ignore_errors=True)
        im.INSERTS_BASE.mkdir(parents=True, exist_ok=True)

    def test_updates_type_counts_from_what_is_actually_on_disk(self):
        d = im.INSERTS_BASE / "temp-local-inserts-counts"
        d.mkdir(parents=True)
        (d / "donor.json").write_text(json.dumps([{"uuid": "u1"}, {"uuid": "u2"}]))
        manifest = {"dest": "temp-local-inserts-counts", "env": "data", "types": {}}
        im.refresh_counts("temp-local-inserts-counts", manifest)
        self.assertEqual(manifest["types"]["donor"]["count"], 2)


class GetAuthKeyTests(unittest.TestCase):
    def setUp(self):
        im.KEYS_FILE.unlink(missing_ok=True)

    def test_raises_when_keys_file_is_missing(self):
        with self.assertRaises(Exception):
            im.get_auth_key("data")

    def test_raises_when_env_is_not_present(self):
        im.KEYS_FILE.write_text(json.dumps({"other-env": {"key": "k", "secret": "s", "server": "https://x"}}))
        with self.assertRaises(Exception):
            im.get_auth_key("data")

    def test_returns_the_entry_when_present(self):
        im.KEYS_FILE.write_text(json.dumps({"data": {"key": "k", "secret": "s", "server": "https://x"}}))
        self.assertEqual(im.get_auth_key("data"), {"key": "k", "secret": "s", "server": "https://x"})


if __name__ == "__main__":
    unittest.main()
