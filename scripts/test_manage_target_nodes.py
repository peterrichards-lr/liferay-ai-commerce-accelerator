"""SSH readiness has to prove authentication, not connectivity.

`wait_for_ssh` polled `socket.create_connection((host, 22))` and called that
ready. A cold-booted EC2 instance accepts a TCP connection on 22 while
`authorized_keys` is still being written, so the check returned success and the
next LDM command was refused at authentication seconds later.

Measured on a single-shard run, with no contention to blame it on:

    07:19:14  SSH service ready on <host>:22
    07:19:32  Cannot reach compute node over SSH -- it refused the SSH credentials

See #1083.

These cover the parts that can be tested without a host to connect to: which
key is chosen, and what the probe actually asks. The probe matters most - a
command missing BatchMode would hang on a password prompt rather than fail,
which in CI is a timeout with no cause attached.

Run with: python3 -m unittest discover -s scripts -p 'test_*.py'
"""

import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import manage_target_nodes as mtn  # noqa: E402


class ResolveSshKey(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("LDM_SSH_KEY")
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("LDM_SSH_KEY", None)
        else:
            os.environ["LDM_SSH_KEY"] = self.saved
        self.tmp.cleanup()

    def test_prefers_the_environment_variable(self):
        key = Path(self.tmp.name) / "explicit.pem"
        key.write_text("x")
        os.environ["LDM_SSH_KEY"] = str(key)

        self.assertEqual(mtn.resolve_ssh_key(), str(key))

    def test_ignores_a_variable_naming_a_file_that_is_not_there(self):
        # Falls through to the CI path rather than handing ssh a bad -i, which
        # fails in a way that reads like a credentials problem.
        os.environ["LDM_SSH_KEY"] = str(Path(self.tmp.name) / "absent.pem")

        self.assertNotEqual(mtn.resolve_ssh_key(), os.environ["LDM_SSH_KEY"])


class SshProbeCommand(unittest.TestCase):
    def test_never_prompts(self):
        # Without BatchMode a missing key becomes a password prompt, and the
        # probe hangs instead of failing. In CI that is a timeout naming nothing.
        cmd = mtn.ssh_probe_command("10.0.0.1", "ldm-automation", "/tmp/k.pem")

        self.assertIn("BatchMode=yes", cmd)

    def test_does_not_stall_on_an_unknown_host_key(self):
        # A node's key changes when the instance is rebuilt; a strict check
        # would refuse and look exactly like refused credentials.
        cmd = mtn.ssh_probe_command("10.0.0.1", "ldm-automation", "/tmp/k.pem")

        self.assertIn("StrictHostKeyChecking=no", cmd)
        self.assertIn("UserKnownHostsFile=/dev/null", cmd)

    def test_carries_the_key_when_there_is_one(self):
        cmd = mtn.ssh_probe_command("10.0.0.1", "ldm-automation", "/tmp/k.pem")

        self.assertEqual(cmd[cmd.index("-i") + 1], "/tmp/k.pem")

    def test_omits_the_key_flag_when_there_is_none(self):
        cmd = mtn.ssh_probe_command("10.0.0.1", "ldm-automation", "")

        self.assertNotIn("-i", cmd)

    def test_runs_the_cheapest_possible_command_as_the_configured_user(self):
        cmd = mtn.ssh_probe_command("10.0.0.1", "ldm-automation", "")

        self.assertEqual(cmd[-2:], ["ldm-automation@10.0.0.1", "true"])

    def test_bounds_the_connect_attempt(self):
        # Without this the probe inherits the system default and a single
        # attempt can outlast the window it is being polled in.
        cmd = mtn.ssh_probe_command("10.0.0.1", "ldm-automation", "")

        self.assertIn("ConnectTimeout=5", cmd)


class WaitForSshActuallyProbes(unittest.TestCase):
    """The regression shape: readiness that never attempts a login.

    Reverting to the old TCP-only check passes every command-shape case above,
    because those only describe what a probe would look like if one were made.
    This asserts one is.
    """

    def setUp(self):
        self.saved = os.environ.get("LDM_SSH_KEY")
        self.tmp = tempfile.TemporaryDirectory()
        key = Path(self.tmp.name) / "k.pem"
        key.write_text("x")
        os.environ["LDM_SSH_KEY"] = str(key)

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("LDM_SSH_KEY", None)
        else:
            os.environ["LDM_SSH_KEY"] = self.saved
        self.tmp.cleanup()

    def test_authenticates_before_reporting_ready(self):
        calls = []

        class Result:
            returncode = 0
            stderr = ""

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return Result()

        with unittest.mock.patch("socket.create_connection"), unittest.mock.patch.object(
            mtn.subprocess, "run", fake_run
        ):
            self.assertTrue(mtn.wait_for_ssh("10.0.0.1", "ldm-automation"))

        self.assertEqual(len(calls), 1, "readiness reported without attempting a login")
        self.assertEqual(calls[0][0], "ssh")
        self.assertEqual(calls[0][-1], "true")

    def test_refuses_when_the_login_never_succeeds(self):
        class Result:
            returncode = 255
            stderr = "Permission denied (publickey)."

        with unittest.mock.patch("socket.create_connection"), unittest.mock.patch.object(
            mtn.subprocess, "run", lambda cmd, **kw: Result()
        ), unittest.mock.patch.object(mtn.time, "sleep", lambda _s: None):
            self.assertFalse(
                mtn.wait_for_ssh("10.0.0.1", "ldm-automation", auth_timeout=1)
            )


if __name__ == "__main__":
    unittest.main()
