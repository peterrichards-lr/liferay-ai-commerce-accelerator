#!/usr/bin/env python3
"""Masks the target-node details in a workflow log, and writes them for use.

The nodes are Peter's own infrastructure, so their names, EC2 instance ids,
regions and hosts live in the NODE_POWER_CONFIG secret rather than in this
public repository. GitHub masks a secret only as its exact full value, and the
parts of this one are printed separately - a node name in "Target 'x' is
remote", an instance id by the AWS CLI - so each part is masked on its own,
before anything can print it. See #1383.

Usage, from a workflow step with NODE_POWER_CONFIG in its environment:

    python3 scripts/node_config_from_secret.py            # mask only
    python3 scripts/node_config_from_secret.py --write    # mask, then write
                                                           # .node-power-config.json

An absent secret is not an error: a fork, or a run against `local`, has no
nodes to hide. A secret that is present but unreadable is, because the run
would otherwise go on to print the very values it failed to mask.

Last Updated: 2026-10-23 | Last Reviewed: 2026-10-23
"""

import argparse
import json
import os
import sys
from pathlib import Path

CONFIG_FILE = Path(__file__).parent.parent / ".node-power-config.json"

# What identifies the infrastructure. `user` and `schedule` are deliberately
# not masked: they are generic ("ubuntu", "auto"), and masking "ubuntu" would
# turn every `ubuntu-latest` in the log into `***-latest`.
SENSITIVE_FIELDS = ("name", "ec2_instance_id", "region", "host")


def values_to_mask(config: dict) -> list:
    """Every node name and identifying value, longest first.

    Longest first because GitHub applies masks in registration order, and a
    short value masked first would leave fragments of a longer one containing
    it - an instance id printed as `i-***` and so on.
    """
    found = set()
    for key, node in (config.get("nodes") or {}).items():
        found.add(str(key))
        if isinstance(node, dict):
            for field in SENSITIVE_FIELDS:
                value = node.get(field)
                if isinstance(value, str) and value.strip():
                    found.add(value.strip())
    return sorted((v for v in found if v.strip()), key=lambda v: (-len(v), v))


def main(argv=None, environ=None, out=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--write", action="store_true", help=f"also write {CONFIG_FILE.name}"
    )
    args = parser.parse_args(argv)
    environ = os.environ if environ is None else environ
    out = out or sys.stdout

    raw = (environ.get("NODE_POWER_CONFIG") or "").strip()
    if not raw:
        print("No NODE_POWER_CONFIG secret; no target nodes to mask.", file=out)
        return 0

    try:
        config = json.loads(raw)
        if not isinstance(config, dict) or not isinstance(config.get("nodes"), dict):
            raise ValueError('expected {"nodes": {...}}')
    except ValueError as error:
        # The reason, never the value: the value is what must not be printed.
        print(f"::error::NODE_POWER_CONFIG is not usable: {error}. See #1383.", file=out)
        return 1

    masked = values_to_mask(config)
    for value in masked:
        print(f"::add-mask::{value}", file=out)

    if args.write:
        CONFIG_FILE.write_text(json.dumps(config, indent=2) + "\n")

    print(
        f"Masked {len(masked)} target-node value(s) for {len(config['nodes'])} node(s)"
        + (f"; wrote {CONFIG_FILE.name}." if args.write else "."),
        file=out,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
