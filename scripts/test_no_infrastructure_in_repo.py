"""No tracked file may carry Peter's infrastructure.

The target nodes' names, EC2 instance ids, regions and public addresses live in
the NODE_POWER_CONFIG secret. They were scrubbed from this public repository in
#1383, and this keeps them out: a test fixture, a comment or a help string is
exactly how they got in the first time.

Node names cannot be checked here without naming them, so this guards what is
recognisable by shape - an EC2 instance id, and a public IPv4 address - and
lets the documentation ranges and placeholders through.

Run with: python3 -m unittest discover -s scripts -p 'test_*.py'
"""

import ipaddress
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

INSTANCE_ID = re.compile(r"\bi-[0-9a-f]{17}\b")
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")

# Placeholders, never real instances.
ALLOWED_INSTANCE_IDS = {"i-0123456789abcdef0", "i-0fedcba9876543210"}

# Strings shaped like a public IPv4 that are not addresses, each with its
# reason. A new entry here needs one too.
ALLOWED_IPV4 = {
    "7.4.3.141": "a Liferay DXP version (7.4.3.141), not an address",
    "1.2.3.4": "a conventional placeholder",
}

# Lockfiles carry integrity hashes and versions, never addresses of ours.
SKIP = ("yarn.lock", "package-lock.json")


def tracked_text_files():
    names = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.split(b"\0")
    for raw in names:
        name = raw.decode()
        if not name or name.endswith(SKIP):
            continue
        path = ROOT / name
        try:
            yield name, path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue


def is_public_address(candidate):
    try:
        address = ipaddress.IPv4Address(candidate)
    except ValueError:
        return False
    documentation = (
        address in ipaddress.IPv4Network("192.0.2.0/24")
        or address in ipaddress.IPv4Network("198.51.100.0/24")
        or address in ipaddress.IPv4Network("203.0.113.0/24")
    )
    return address.is_global and not documentation


class NoInfrastructureInTrackedFiles(unittest.TestCase):
    def test_no_real_ec2_instance_id(self):
        found = [
            f"{name}: {match}"
            for name, text in tracked_text_files()
            for match in set(INSTANCE_ID.findall(text))
            if match not in ALLOWED_INSTANCE_IDS
        ]
        self.assertEqual(found, [], "EC2 instance ids belong in NODE_POWER_CONFIG")

    def test_no_public_ipv4_address(self):
        found = [
            f"{name}: {match}"
            for name, text in tracked_text_files()
            for match in set(IPV4.findall(text))
            if match not in ALLOWED_IPV4 and is_public_address(match)
        ]
        self.assertEqual(
            found,
            [],
            "Use 203.0.113.0/24 (RFC 5737) in examples; real hosts belong in NODE_POWER_CONFIG",
        )

    def test_the_patterns_catch_what_they_are_for(self):
        # A guard that matches nothing passes forever. The samples are made up,
        # and assembled at run time: written out, this file would fail its own
        # scan the moment it is tracked - which is what the first version did.
        made_up_id = "i-" + "0a1b2c3d" + "4e5f60718"
        public = ".".join(["8"] * 4)
        self.assertTrue(INSTANCE_ID.search(f"id {made_up_id} here"))
        self.assertTrue(is_public_address(public))
        self.assertFalse(is_public_address("203.0.113.10"))
        self.assertFalse(is_public_address("10.0.0.1"))
        self.assertFalse(is_public_address("127.0.0.1"))


if __name__ == "__main__":
    unittest.main()
