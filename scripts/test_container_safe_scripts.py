"""Every shell script in `scripts/` must refuse to run inside Liferay.

The E2E mounts this whole directory as the Liferay entrypoint's script
directory, and the entrypoint executes everything in it. A script that exits
non-zero there takes the container with it.

That is not a hypothetical. `check-docs-rendered.sh` was added on 2026-10-15
without the guard the other three already carried. Liferay ran it with
`/mnt/liferay/scripts` as its argument, it found no HTML and exited 1 - exactly
as designed - and every bring-up from 2026-10-16 failed in ~130s with an empty
Liferay log. Identical on ldm 2.26.3 and 2.26.6, and on aws-1 and aws-2, so
neither the version nor the node had anything to do with it. See #1360.

The hazard is the DIRECTORY, not that one file. This checks all of them, so
the next script added without the guard fails here rather than in the next
nightly.
"""

import pathlib
import unittest

SCRIPTS_DIR = pathlib.Path(__file__).resolve().parent

# `$LIFERAY_HOME` in a script without `set -u`; `${LIFERAY_HOME:-}` in one with
# it, where the bare form aborts on "unbound variable" before the test runs.
# Both are correct; a script must use whichever its own options allow.
ACCEPTED_SPELLINGS = ('[ -n "$LIFERAY_HOME" ]', '[ -n "${LIFERAY_HOME:-}" ]')


def guards_against_the_liferay_entrypoint(text):
    """True if the script refuses to run inside the Liferay container."""
    return "[ -f /.dockerenv ]" in text and any(s in text for s in ACCEPTED_SPELLINGS)


class EveryShellScriptRefusesToRunInsideLiferay(unittest.TestCase):
    def setUp(self):
        self.scripts = sorted(SCRIPTS_DIR.glob("*.sh"))

    def test_there_are_scripts_to_check(self):
        """Without this, an empty glob would make every case below vacuous."""
        self.assertGreater(len(self.scripts), 0, f"No *.sh found under {SCRIPTS_DIR}")

    def test_each_one_carries_the_guard(self):
        unguarded = [
            s.name
            for s in self.scripts
            if not guards_against_the_liferay_entrypoint(s.read_text(encoding="utf-8"))
        ]
        self.assertEqual(
            unguarded,
            [],
            "These run inside Liferay and will kill the container if they exit "
            "non-zero. Add the guard from run-e2e-ldm.sh. See #1360: "
            f"{unguarded}",
        )


class TheDetectorItself(unittest.TestCase):
    """The cases above would pass just as happily against a function that
    always returns True. These drive it with known input."""

    def test_rejects_a_script_with_no_guard(self):
        self.assertFalse(guards_against_the_liferay_entrypoint("#!/bin/bash\nexit 1\n"))

    def test_rejects_a_dockerenv_check_without_the_liferay_home_half(self):
        # One condition alone is not the guard: `ldm` can run the entrypoint in
        # contexts where only the other is true.
        self.assertFalse(
            guards_against_the_liferay_entrypoint('if [ -f /.dockerenv ]; then exit 0; fi')
        )

    def test_accepts_the_bare_spelling(self):
        self.assertTrue(
            guards_against_the_liferay_entrypoint(
                'if [ -f /.dockerenv ] || [ -n "$LIFERAY_HOME" ]; then exit 0; fi'
            )
        )

    def test_accepts_the_set_u_safe_spelling(self):
        self.assertTrue(
            guards_against_the_liferay_entrypoint(
                'if [ -f /.dockerenv ] || [ -n "${LIFERAY_HOME:-}" ]; then exit 0; fi'
            )
        )


if __name__ == "__main__":
    unittest.main()
