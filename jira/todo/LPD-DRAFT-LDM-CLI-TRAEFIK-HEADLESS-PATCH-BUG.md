# LDM CLI fails to patch fragment overrides via Headless API when SSL (Traefik) is active

## Environment

- LDM CLI: 2.15.14
- Host: Local macOS
- Configuration: `ldm import` with `--host-name <custom>.local` (SSL active)

## Bug Description

During LDM environment boot or import, the `_patch_fragment_overrides` function in `ldm_core/handlers/runtime.py` attempts to dynamically hit Liferay's Headless APIs to patch `fragment-overrides.json` payloads.
To determine the host target URL, LDM relies on querying Docker for Liferay's port:

```python
inspect_output = self.manager.run_command(
    ["docker", "port", container_name, "8080"],
    check=False,
    capture_output=True,
)
```

When Traefik SSL is active, the `8080` port is not mapped directly to the host machine. The `docker port` command returns nothing, causing LDM to fallback to `127.0.0.1:8080`, which yields `Connection refused`.
LDM does not attempt to route the request through the Traefik proxy endpoint (e.g. `https://<custom>.local`) because doing so would require bypassing SSL certificate verification for self-signed `mkcert` certificates (which Python's `urllib` rejects by default without a custom unverified context).

## Steps to Reproduce

1. Execute `ldm import <repo> -p <name> --host-name <name>.local`
2. Ensure the repository contains `.ldm/fragment-overrides.json`
3. Wait for LDM to reach the headless API patch stage.
4. Note the error: `Headless API request failed: <urlopen error [Errno 61] Connection refused>`

## Impact

Fragment overrides are skipped, causing Client Extension routing configurations (like the React dashboard microservice target) to fail to propagate dynamically.

## Workaround

1. Import the environment using `--no-ssl` to ensure `8080` is mapped and the patches apply over plain HTTP.
2. Once the environment is running and patched, re-enable SSL with `ldm config ssl true` and restart the stack.

<!-- markdownlint-disable MD049 -->
---
*Last Updated: 2026-07-08* | *Last Reviewed: 2026-07-08*
