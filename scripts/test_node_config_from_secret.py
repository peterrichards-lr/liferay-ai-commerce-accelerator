"""Tests for node_config_from_secret.py.

The values below are placeholders - RFC 5737 addresses and a documentation
instance id - never real infrastructure. See #1383.

Run with: python3 -m unittest discover -s scripts -p 'test_*.py'
"""

import io
import json
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import node_config_from_secret as subject  # noqa: E402

CONFIG = {
    "nodes": {
        "node-a": {
            "name": "node-a",
            "ec2_instance_id": "i-0123456789abcdef0",
            "region": "xx-example-1",
            "host": "203.0.113.10",
            "user": "ubuntu",
            "schedule": "auto",
        },
        "node-b": {
            "name": "node-b",
            "ec2_instance_id": "i-0fedcba9876543210",
            "region": "xx-example-1",
            "user": "ubuntu",
            "schedule": "auto",
        },
    }
}


def run(argv=(), secret=None):
    out = io.StringIO()
    environ = {} if secret is None else {"NODE_POWER_CONFIG": secret}
    code = subject.main(list(argv), environ=environ, out=out)
    return code, out.getvalue()


class MasksEveryIdentifyingValue(unittest.TestCase):
    def test_masks_names_instance_ids_regions_and_hosts(self):
        code, out = run(secret=json.dumps(CONFIG))

        self.assertEqual(code, 0)
        for value in (
            "node-a",
            "node-b",
            "i-0123456789abcdef0",
            "i-0fedcba9876543210",
            "xx-example-1",
            "203.0.113.10",
        ):
            self.assertIn(f"::add-mask::{value}\n", out)

    def test_does_not_mask_the_generic_user(self):
        # Masking "ubuntu" would turn every `ubuntu-latest` into `***-latest`.
        _, out = run(secret=json.dumps(CONFIG))
        self.assertNotIn("::add-mask::ubuntu", out)
        self.assertNotIn("::add-mask::auto", out)

    def test_masks_before_it_says_anything_else(self):
        # A summary naming a node ahead of its mask would print it in clear.
        _, out = run(secret=json.dumps(CONFIG))
        lines = out.splitlines()
        last_mask = max(i for i, l in enumerate(lines) if l.startswith("::add-mask::"))
        self.assertEqual(last_mask, len(lines) - 2)

    def test_longest_values_are_masked_first(self):
        masked = subject.values_to_mask(CONFIG)
        self.assertEqual(masked, sorted(masked, key=lambda v: (-len(v), v)))

    def test_masks_each_value_once(self):
        _, out = run(secret=json.dumps(CONFIG))
        self.assertEqual(out.count("::add-mask::xx-example-1\n"), 1)


class Writing(unittest.TestCase):
    def test_writes_the_config_only_when_asked(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / ".node-power-config.json"
            with unittest.mock.patch.object(subject, "CONFIG_FILE", target):
                run(secret=json.dumps(CONFIG))
                self.assertFalse(target.exists())

                run(["--write"], secret=json.dumps(CONFIG))
                self.assertEqual(json.loads(target.read_text()), CONFIG)


class RefusesQuietlyOrLoudlyAsAppropriate(unittest.TestCase):
    def test_an_absent_secret_is_not_an_error(self):
        # A fork, or a run against `local`, has nothing to hide.
        code, out = run()
        self.assertEqual(code, 0)
        self.assertNotIn("::add-mask::", out)

    def test_an_unreadable_secret_fails_without_echoing_it(self):
        secret = '{"nodes": node-a is not json'
        code, out = run(secret=secret)

        self.assertEqual(code, 1)
        self.assertIn("::error::", out)
        self.assertNotIn("node-a", out)

    def test_a_secret_of_the_wrong_shape_fails(self):
        code, out = run(secret=json.dumps({"node-a": {}}))
        self.assertEqual(code, 1)
        self.assertIn("::error::", out)


if __name__ == "__main__":
    unittest.main()
