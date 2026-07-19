---
name: build-environment
description: Activate this skill when editing workspace package configurations, running Gradle tasks, or managing dependency locks.
---

# Build Environment & Dependency Integrity

To ensure monorepo build stability and prevent runtime environment conflicts, the following rules must be strictly adhered to:

## 1. Node & Tooling Constraints

- **Node.js version**: Enforced at `v22.22.2` via `build.gradle` `nodeVersion` configuration.
- **Build Infrastructure**: Standardized on Vite 6.0.0 and modern build dependencies across all client extensions to resolve native binary and ESM/CJS compatibility conflicts.
- **Gradle Node Cache**: If build/deploy failures occur, always ensure the `.gradle/node` cache is cleared (`rm -rf .gradle/node`) before re-running the build to force synchronization with the project's enforced Node version.
- **Dismissal of Alerts**: Any dependabot alerts recommending upgrades for build tools should be reviewed against these pinned versions before applying.

## 2. Dependabot & Lockfile Integrity

- **Yarn Dominance**: Yarn is the authoritative package manager for this monorepo.
- **No package-lock.json**: To prevent 'npm_and_yarn' conflicts in CI and Dependabot, **NEVER** commit a `package-lock.json` file.
- **Explicit Scoping**: The `.github/dependabot.yml` file explicitly defines the ecosystem and directories for automated updates to ensure monorepo-wide consistency.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-19_ | _Last Reviewed: 2026-07-19_
