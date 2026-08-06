---
name: coding-standards
description: Activate this skill when writing or refactoring microservice and SDK javascript/typescript source files.
---

# Coding & Clean Code Standards

All code contributions must follow these clean coding standards:

## 1. Code Style & Self-Documentation

- **Comments**: Default to writing no comments — well-named identifiers and clear control flow should make code self-explanatory. Only add a comment when it captures a non-obvious **WHY** (a hidden constraint, a workaround, an invariant) that isn't derivable by reading the code; never add one that just restates **WHAT** the code already shows.
- **Zero Warning Mandate**: The codebase must be free of lint warnings and formatting errors.
- **Workspace-wide Formatting**: When applying formatting fixes using Prettier, you MUST execute `prettier --write .` across the entire workspace root. You are FORBIDDEN from formatting files individually or at a directory level, as this causes PR checks to fail due to unformatted peripheral files.
- **Intentional Omissions**: Use the **`_` (underscore)** prefix for any intentionally unused parameters, variables, or caught errors (e.g., `const { unused: _unused } = obj`, `catch (_err) {}`). The ESLint config is hardened to support this pattern without warnings.

## 2. Agent Constraints

The AI agent must **not**:

- **Source Control Changes**: Before making any source control changes (commits, reverts, rebases), you MUST draft an implementation plan, present it to the user, and wait for their explicit approval. You are FORBIDDEN from executing these `git` commands until the user explicitly approves the plan.
- **Pull Request Creation Requirements**: Before executing `gh pr create`, you MUST run `gh issue view <issue-number>` and `git fetch origin` and check their output to verify that: 1) the target issue exists and contains a description, resolution analysis, and an implementation plan, and 2) your feature branch is fully up to date with the remote `master` branch. You are FORBIDDEN from opening the PR until these checks pass. When creating the PR, it MUST explicitly close or resolve the targeted issue(s).
- **Failed CI Job Cleanup**: If a GitHub Action workflow fails on a Pull Request, after pushing a fix, run `gh run delete <run-id>` to delete the failed job(s) and confirm the cleanup succeeded. You are FORBIDDEN from reporting the fix as complete until all historical failed runs for that PR are deleted, ensuring only green jobs remain.
- bypass verification gates.

The AI agent **should**:

- perform dry code analysis.
- reason about control flow, concurrency, idempotency, and failure paths.
- surface likely bugs or race conditions early.
- **No Assumptions (Anti-Hallucination Rule)**: Before generating any technical statement, explanation, or conclusion about how systems (like edge nodes or routing logic) behave, you MUST verify against the actual codebase first — use Grep/Read/Bash to fetch the relevant source code or documentation, then formulate your answer using what you found. You are FORBIDDEN from stating how something behaves without having just verified it.

## 3. Native Identifier Strategy

- **Eliminate `uuid` Dependency**: To reduce security surface area and avoid CommonJS/ESM compatibility friction, **DO NOT** use the `uuid` npm package in the microservice.
- **Authority**: Use Node.js's built-in **`crypto.randomUUID()`** for all random identifier generation (ERCs, correlation IDs, task IDs).

## 4. Technical Debt Tracking

- **Detect & Record**: If you identify code changes that fall into the 10 technical debt categories, before ending your task, run `scripts/gh-issue-sync.cjs` to raise a GitHub issue with the `tech debt` label and confirm it was recorded. You are FORBIDDEN from reporting the task complete until the issue is recorded.
  1. **Code Smells** (poor design patterns, unreadable logic)
  2. **Duplication** (identical/similar code blocks, helper repetition)
  3. **Over-Complexity** (monolithic functions, hard-to-maintain flows)
  4. **Fragile Coupling** (tightly bound packages, direct database or internal layer bypasses)
  5. **Missing Safety Guards** (lacking exception handling, missing null/undefined pointer checks)
  6. **Missing Tests** (uncovered code branches, lack of unit or integration testing coverage)
  7. **Security Hygiene** (hardcoded secrets, unvalidated user input, dangerous dependencies)
  8. **Deprecated Patterns** (using outdated APIs or legacy library functions)
  9. **Config Drift** (inconsistencies between configuration profiles or docker environments)
  10. **Documentation Debt** (outdated markdown guides, missing timestamp footers, lack of setup instructions)
- **Immediate Resolution**: You do not need to resolve the technical debt immediately. However, if it can be resolved quickly without significant deviation or effort from the primary task, you may do so. The primary requirement is to ensure it is recorded.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-03_ | _Last Reviewed: 2026-08-03_
