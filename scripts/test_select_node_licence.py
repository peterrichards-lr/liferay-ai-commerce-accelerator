"""Tests for select_node_licence.py. Node names are placeholders (#1383).

Run with: python3 -m unittest discover -s scripts -p 'test_*.py'
"""

import io
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import select_node_licence as subject  # noqa: E402

KEY = "<license>for node-a</license>"


class SelectsTheTargetsKey(unittest.TestCase):
    def run_with(self, target, secrets):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        github_env = Path(tmp.name) / "github_env"
        github_env.write_text("")
        out = io.StringIO()
        code = subject.main(
            environ={
                "E2E_TARGET_NODE": target,
                "ALL_SECRETS": json.dumps(secrets),
                "RUNNER_TEMP": tmp.name,
                "GITHUB_ENV": str(github_env),
            },
            out=out,
        )
        return code, out.getvalue(), github_env.read_text(), Path(tmp.name)

    def test_writes_the_key_to_a_private_file_and_passes_only_its_path(self):
        code, out, github_env, temp = self.run_with(
            "node-a", {"LIFERAY_LICENSE_NODE_A": KEY, "OTHER": "x"}
        )
        key_file = temp / "node-activation-key.xml"

        self.assertEqual(code, 0)
        self.assertEqual(key_file.read_text(), KEY)
        self.assertEqual(stat.S_IMODE(key_file.stat().st_mode), 0o600)
        self.assertEqual(github_env, f"LIFERAY_LICENSE_FILE={key_file}\n")
        self.assertNotIn(KEY, out)
        self.assertNotIn(KEY, github_env)

    def test_names_neither_the_node_nor_the_secret_when_there_is_none(self):
        code, out, github_env, _ = self.run_with("node-b", {"LIFERAY_LICENSE_NODE_A": KEY})

        self.assertEqual(code, 0)
        self.assertEqual(github_env, "")
        self.assertNotIn("node-b", out)
        self.assertNotIn("LIFERAY_LICENSE_NODE_B", out)

    def test_does_nothing_for_a_local_target(self):
        code, out, github_env, _ = self.run_with("local", {"LIFERAY_LICENSE_LOCAL": KEY})
        self.assertEqual((code, github_env), (0, ""))

    def test_the_naming_rule_matches_the_existing_secrets(self):
        self.assertEqual(subject.secret_name_for("node-a"), "LIFERAY_LICENSE_NODE_A")
        self.assertEqual(subject.secret_name_for("x.y-2"), "LIFERAY_LICENSE_X_Y_2")


if __name__ == "__main__":
    unittest.main()
