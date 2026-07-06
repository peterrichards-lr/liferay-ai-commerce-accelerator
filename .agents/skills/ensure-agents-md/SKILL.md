---
name: ensure-agents-md
description: Run FIRST before any task when workspace root lacks AGENTS.md. Creates AGENTS.md tailored to the Node.js/Yarn monorepo environment.
---

# Ensure AGENTS.md (Bootstrap)

Before any other work, the agent MUST:

1. Check whether `AGENTS.md` exists at the workspace root.
2. If it exists, skip this skill entirely.
3. If it does not exist, create `AGENTS.md` based on the Node.js/Yarn environment.

## Steps

1. **Verify Environment**: Check `package.json` and `yarn.lock` to confirm this is the AICA monorepo.
2. **Generate AGENTS.md**: Create `AGENTS.md` with instructions for AI coding agents to strictly use `yarn` (never `npm` or `package-lock.json`), reference the `aica_developer` skill, and outline the monorepo workspace packages.
3. **Inform User**: Tell the user that the bootstrap is complete, and proceed with their request.
