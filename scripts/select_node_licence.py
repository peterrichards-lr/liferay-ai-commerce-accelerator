#!/usr/bin/env python3
"""Picks the target node's activation key without naming it in the workflow.

Activation keys are issued per machine, so each remote node has its own secret,
LIFERAY_LICENSE_<NODE>. Referencing those as `secrets.LIFERAY_LICENSE_<NODE>`
put the node names in the public workflow. So the workflow hands this step the
secrets as one JSON object (`toJSON(secrets)`), and this picks the one for the
target by the same naming rule. See #1383, #805.

The key is written to a private file and only its PATH is passed on, through
GITHUB_ENV as LIFERAY_LICENSE_FILE. Exporting the key itself would print it in
every later step's environment listing.

LIFERAY_LICENSE - a developer licence for local runs and other situations - is
not this script's concern; run-e2e-ldm.sh falls back to it, and says so.

Last Updated: 2026-10-23 | Last Reviewed: 2026-10-23
"""

import json
import os
import re
import sys
from pathlib import Path


def secret_name_for(target: str) -> str:
    """LIFERAY_LICENSE_<TARGET>, upper-cased, anything else made an underscore."""
    return "LIFERAY_LICENSE_" + re.sub(r"[^A-Z0-9]", "_", target.upper())


def main(environ=None, out=None) -> int:
    environ = os.environ if environ is None else environ
    out = out or sys.stdout
    target = (environ.get("E2E_TARGET_NODE") or "").strip()

    if not target or target == "local":
        print("Local target: no node activation key to select.", file=out)
        return 0

    try:
        secrets = json.loads(environ.get("ALL_SECRETS") or "{}")
    except ValueError:
        secrets = {}

    licence = secrets.get(secret_name_for(target)) or ""
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

    github_env = environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as env_file:
            env_file.write(f"LIFERAY_LICENSE_FILE={key_file}\n")

    print("Selected the target node's activation key.", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
