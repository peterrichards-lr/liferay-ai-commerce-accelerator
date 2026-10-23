"""Every shell script in `scripts/` must refuse to run inside Liferay.

The E2E mounts this whole directory as the Liferay entrypoint's script
directory, and the entrypoint executes everything in it. A script that exits
non-zero there takes the container with it.

That is not a hypothetical. `check-docs-rendered.sh` was added on 2026-10-15
without the guard the other three already carried. Liferay ran it with
`/mnt/liferay/scripts` as its argument, it found no HTML and exited 1 - exactly
as designed - and every bring-up from 2026-10-16 failed in ~130s with an empty
Liferay log. Identical on ldm 2.26.3 and 2.26.6, and on node-a and node-b, so
neither the version nor the node had anything to do with it. See #1360.

The hazard is the DIRECTORY, not that one file. This checks all of them, so
the next script added without the guard fails here rather than in the next
nightly.

Carrying the guard is necessary and NOT sufficient. The entrypoint SOURCES
these files, so shell options set before the guard runs survive into
configure_liferay.sh, which has an unset LIFERAY_TOMCAT_AJP_PORT on line 144.
#1360's fix put the guard below `set -euo pipefail`; every script then exited
early and said so, and the boot died anyway on the leaked `-u`. So the ordering
is checked too. See #1362, and lcp-scripts/deploy.sh, which has warned about
this same variable since long before either.
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


def _line_index(lines, predicate):
    for i, line in enumerate(lines):
        if predicate(line):
            return i
    return None


def set_options_leaking_past_the_guard(text):
    """`set` lines that run BEFORE the guard, and so leak into the caller.

    Returns them as `(line number, text)`. Empty means either that the script
    sets no options, or that it sets them only after it has decided it is not
    inside the container.
    """
    lines = text.split("\n")
    guard = _line_index(lines, lambda l: "[ -f /.dockerenv ]" in l)
    if guard is None:
        return []
    return [
        (i + 1, lines[i].strip())
        for i in range(guard)
        if lines[i].strip().startswith("set -")
    ]


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

    def test_no_shell_options_are_set_before_the_guard(self):
        """The guard must leave the caller's shell as it found it.

        The entrypoint sources these files. `set -u` reached before the early
        return stays set in configure_liferay.sh, whose line 144 reads an unset
        LIFERAY_TOMCAT_AJP_PORT - so the boot dies after the guard has already
        done its job and printed that it was exiting. See #1362.
        """
        leaking = {
            s.name: set_options_leaking_past_the_guard(s.read_text(encoding="utf-8"))
            for s in self.scripts
        }
        leaking = {name: opts for name, opts in leaking.items() if opts}
        self.assertEqual(
            leaking,
            {},
            "These set shell options before the container guard runs, and the "
            "entrypoint sources them, so the options leak into "
            "configure_liferay.sh and kill the boot. Move the `set` line below "
            f"the guard block. See #1362: {leaking}",
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


class TheOrderingDetectorItself(unittest.TestCase):
    """Same discipline as above: known input, both answers."""

    GUARD = 'if [ -f /.dockerenv ] || [ -n "${LIFERAY_HOME:-}" ]; then exit 0; fi'

    def test_flags_set_above_the_guard(self):
        found = set_options_leaking_past_the_guard(
            f"#!/bin/bash\nset -euo pipefail\n{self.GUARD}\n"
        )
        self.assertEqual(found, [(2, "set -euo pipefail")])

    def test_accepts_set_below_the_guard(self):
        self.assertEqual(
            set_options_leaking_past_the_guard(
                f"#!/bin/bash\n{self.GUARD}\nset -euo pipefail\n"
            ),
            [],
        )

    def test_flags_a_bare_set_e_too(self):
        # `-e` leaks exactly as `-u` does. It happened not to be fatal here
        # only because nothing in configure_liferay.sh returned non-zero after
        # it; that is luck, not a property worth relying on.
        self.assertEqual(
            set_options_leaking_past_the_guard(f"#!/bin/bash\nset -e\n{self.GUARD}\n"),
            [(2, "set -e")],
        )

    def test_says_nothing_about_a_script_with_no_guard(self):
        # That case is the other test's to report. Returning [] here keeps the
        # two failures from being reported as one confusing one.
        self.assertEqual(
            set_options_leaking_past_the_guard("#!/bin/bash\nset -u\necho hi\n"), []
        )


if __name__ == "__main__":
    unittest.main()
