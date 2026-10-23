#!/usr/bin/env python3
"""Picks the target node's activation key without naming it in the workflow.

Activation keys are issued per machine, so each remote node has its own secret,
LIFERAY_LICENSE_<NODE>. Referencing those as `secrets.LIFERAY_LICENSE_<NODE>`
put the node names in the public workflow (#1383). Passing `toJSON(secrets)`
avoided that, and GitHub then held every run for approval, because the step
received the whole secrets context.

So it takes two steps, with a computed key - `secrets[...]` - in between:

    python3 scripts/select_node_licence.py --resolve
        works out LIFERAY_LICENSE_<TARGET> by the existing naming rule, masks
        that name (it carries the node's name), and exports it as
        E2E_LICENCE_SECRET.

    NODE_LICENCE: ${{ secrets[env.E2E_LICENCE_SECRET] }}
    python3 scripts/select_node_licence.py
        writes that one key to a private file and exports only its PATH as
        LIFERAY_LICENSE_FILE. Exporting the key itself would print it in every
        later step's environment.

LIFERAY_LICENSE - a developer licence - is not this script's concern;
run-e2e-ldm.sh falls back to it, and says so. See #805.

Last Updated: 2026-10-23 | Last Reviewed: 2026-10-23
"""

import argparse
import os
import re
import sys
from pathlib import Path


def secret_name_for(target: str) -> str:
    """LIFERAY_LICENSE_<TARGET>, upper-cased, anything else made an underscore."""
    return "LIFERAY_LICENSE_" + re.sub(r"[^A-Z0-9]", "_", target.upper())


def export(environ, line: str) -> None:
    github_env = environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as env_file:
            env_file.write(line + "\n")


def main(argv=None, environ=None, out=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="export the name of the target's licence secret, masked",
    )
    args = parser.parse_args(argv)
    environ = os.environ if environ is None else environ
    out = out or sys.stdout
    target = (environ.get("E2E_TARGET_NODE") or "").strip()

    if not target or target == "local":
        print("Local target: no node activation key to select.", file=out)
        return 0

    if args.resolve:
        name = secret_name_for(target)
        print(f"::add-mask::{name}", file=out)
        export(environ, f"E2E_LICENCE_SECRET={name}")
        return 0

    licence = environ.get("NODE_LICENCE") or ""
    if not licence.strip():
        # Names neither the node nor the secret: both would print in clear
        # when the target came from a dispatch input rather than a secret.
        print(
            "No activation key is configured for the target node; "
            "run-e2e-ldm.sh will fall back to LIFERAY_LICENSE.",
            file=out,
        )
        return 0

    temp = Path(environ.get("RUNNER_TEMP") or "/tmp")
    key_file = temp / "node-activation-key.xml"
    key_file.write_text(licence)
    key_file.chmod(0o600)
    export(environ, f"LIFERAY_LICENSE_FILE={key_file}")

    print("Selected the target node's activation key.", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
