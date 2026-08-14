# AI Commerce Accelerator - Canonical Agent Context

Welcome to the **Liferay AI Commerce Accelerator (AICA)** codebase. This document serves as the **single source of truth** for all AI coding assistants, orchestrators, and tools operating in this repository.

---

## 1. Project Identity

- **Project Name**: Liferay AI Commerce Accelerator (AICA)
- **Primary Languages & Runtimes**: Node.js (v18/v20), TypeScript, Java (OSGi / Gradle), Docker, Python (LDM CLI)
- **Architecture**: Liferay DXP Client Extensions (Microservice, Custom Element, Global JS), Headless Commerce APIs, Modular SDKs, AI/LLM Orchestration
- **Documentation Root**: [`docs/`](docs/) and [`docs/architecture/`](docs/architecture/)

---

## 2. Conventions & Guardrails (Skills Routing)

To prevent cognitive overload and maintain strict execution standards, rules are modularized into active skill files located under [`.agents/skills/`](.agents/skills/). Consult the routing table below:

| Skill Name                                                                         | Path                                                                                                     | Trigger Condition / When to Load                                | Description                                                                             |
| :--------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| **[aica-developer](.agents/skills/aica_developer/SKILL.md)**                       | [`.agents/skills/aica_developer/SKILL.md`](.agents/skills/aica_developer/SKILL.md)                       | Developing, running CLI commands, linting, monorepo build setup | Monorepo conventions, CLI workflows, and dev environment guides.                        |
| **[e2e-verification](.agents/skills/e2e-verification/SKILL.md)**                   | [`.agents/skills/e2e-verification/SKILL.md`](.agents/skills/e2e-verification/SKILL.md)                   | Verifying changes, running E2E tests, checking DoD              | Governs E2E testing commands, container setups, and DoD check procedures.               |
| **[client-extension-routing](.agents/skills/client-extension-routing/SKILL.md)**   | [`.agents/skills/client-extension-routing/SKILL.md`](.agents/skills/client-extension-routing/SKILL.md)   | Editing YAML configuration files                                | Guardrails preventing manual `serviceAddress` modifications in `client-extension.yaml`. |
| **[build-environment](.agents/skills/build-environment/SKILL.md)**                 | [`.agents/skills/build-environment/SKILL.md`](.agents/skills/build-environment/SKILL.md)                 | Editing lockfiles, package configs, or Gradle tasks             | Node.js/Vite versions pinning, Yarn lock rules, and Gradle cache handling.              |
| **[coding-standards](.agents/skills/coding-standards/SKILL.md)**                   | [`.agents/skills/coding-standards/SKILL.md`](.agents/skills/coding-standards/SKILL.md)                   | Writing or refactoring microservice/SDK source code             | Self-documenting code style, dry-run profiling, and native identifier practices.        |
| **[quality-guardrails](.agents/skills/quality-guardrails/SKILL.md)**               | [`.agents/skills/quality-guardrails/SKILL.md`](.agents/skills/quality-guardrails/SKILL.md)               | Modifying service layers or preparing to commit                 | Service parity verification, bootstrap `verifySteps` checks, and pre-commit hooks.      |
| **[platform-findings](.agents/skills/platform-findings/SKILL.md)**                 | [`.agents/skills/platform-findings/SKILL.md`](.agents/skills/platform-findings/SKILL.md)                 | Troubleshooting API errors or seeding database engines          | Quirks on sequencing, `productType` constraints, SKU active rules, and indexing.        |
| **[documentation](.agents/skills/documentation/SKILL.md)**                         | [`.agents/skills/documentation/SKILL.md`](.agents/skills/documentation/SKILL.md)                         | Creating or modifying markdown documentation                    | Active documentation review, format verification, and timestamp hygiene rules.          |
| **[multi-agent-orchestration](.agents/skills/multi-agent-orchestration/SKILL.md)** | [`.agents/skills/multi-agent-orchestration/SKILL.md`](.agents/skills/multi-agent-orchestration/SKILL.md) | Delegating tasks or defining subagents                          | Orchestrating parallel workflows and delegating to specialized subagents.               |
| **[tool-use-react](.agents/skills/tool-use-react/SKILL.md)**                       | [`.agents/skills/tool-use-react/SKILL.md`](.agents/skills/tool-use-react/SKILL.md)                       | Terminal tool calls or invoking GitHub APIs                     | Strict ReAct reasoning patterns and GitHub CLI (`gh`) usage boundaries.                 |
| **[reflection-and-planning](.agents/skills/reflection-and-planning/SKILL.md)**     | [`.agents/skills/reflection-and-planning/SKILL.md`](.agents/skills/reflection-and-planning/SKILL.md)     | Beginning complex tasks or modifying codebase files             | Mandatory implementation plans and predictive failure analysis.                         |
| **[human-in-the-loop](.agents/skills/human-in-the-loop/SKILL.md)**                 | [`.agents/skills/human-in-the-loop/SKILL.md`](.agents/skills/human-in-the-loop/SKILL.md)                 | Deploying, dropping databases, or opening PRs                   | Strict human verification gates before destructive or final operations.                 |
| **[jira-tracker](.agents/skills/jira_tracker/SKILL.md)**                           | [`.agents/skills/jira_tracker/SKILL.md`](.agents/skills/jira_tracker/SKILL.md)                           | Upstream Liferay platform bugs or limitations                   | Documenting and tracking upstream bugs as `JIRA`-labeled GitHub issues.                 |

### Architectural Documentation Reference

Detailed architectural specifications are maintained in [`docs/architecture/`](docs/architecture/):

- [Workflow & Batching (WebSocket, Correlation, Media)](docs/architecture/workflow-and-batching.md)
- [Liferay API Constraints (OData, DTOs, Pricing, Glue)](docs/architecture/liferay-api-constraints.md)
- [E2E & Orchestration (LDM, Deployment Patterns)](docs/architecture/e2e-and-orchestration.md)
- [Frontend & UI Standards (Stylebook, UI/UX)](docs/architecture/frontend-and-ui.md)
- [Microservice Architecture (SDK, Storage, Providers)](docs/architecture/microservice-architecture.md)

---

## 3. Global Directives

1. **Single Source of Truth**: All AI agents (Gemini, Claude, Cursor, Windsurf, Copilot, etc.) must follow `AGENTS.md`. Do not duplicate context into provider-specific discovery files.
2. **Mandatory Documentation Timestamps**: Every created or modified `.md` file must conclude with the standard timestamp footer (`<!-- markdownlint-disable MD049 -->` followed by `*Last Updated: YYYY-MM-DD* | *Last Reviewed: YYYY-MM-DD*`).
3. **No Hardcoded Credentials**: Use `Liferay.authToken` and environment configuration for credentials. Never commit secrets.
4. **Non-Interactive Execution**: Always pass non-interactive flags (`-y`, `--non-interactive`) when running developer tools or CLI scripts.
5. **Deduplication & DRY**: Inspect existing utility modules and skills before creating new helpers.

---

## 4. Current Work State

Active, in-flight task state and intra-task scratchpad context are maintained locally in `.agent-state.md` (gitignored).

- **On Session Startup**: If `.agent-state.md` exists, read it to discover active objectives and resume in-flight work without lost context across AI provider switches.
- **During Execution**: Update `.agent-state.md` when making progress, encountering blockers, or pausing a workflow.
- **On Feature Completion**: Clear/reset `.agent-state.md` once all objectives and DoD verifications are met.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-14_ | _Last Reviewed: 2026-08-14_
