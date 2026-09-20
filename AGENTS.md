# AI Commerce Accelerator - Canonical Agent Context

Welcome to the **Liferay AI Commerce Accelerator (AICA)** codebase. This document serves as the **single source of truth** for all AI coding assistants, orchestrators, and tools operating in this repository.

---

## 1. Project Identity

- **Project Name**: Liferay AI Commerce Accelerator (AICA)
- **Primary Languages & Runtimes**: Node.js (pinned by `.nvmrc` and `nodeVersion`
  in `build.gradle`; `package.json` requires `>=22.12.0` — check those rather
  than trusting a version quoted here), TypeScript, Java (OSGi / Gradle, see
  `.java-version`), Docker, Python (LDM CLI)
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

**Single Source of Truth**: All AI agents (Gemini, Claude, Cursor, Windsurf, Copilot, etc.) must follow `AGENTS.md`. Do not duplicate context into the provider discovery files (`GEMINI.md`, `CLAUDE.md`), which exist only so each tool finds this one and redirect straight back here.

That is the only directive this file owns. The rest live with the skill that owns the concern, so each rule has exactly one home to read and one place to change:

| Directive                                  | Owning skill                                                     |
| :----------------------------------------- | :--------------------------------------------------------------- |
| Documentation timestamps and footer format | [`documentation`](./.agents/skills/documentation/SKILL.md)       |
| No hardcoded credentials                   | [`coding-standards`](./.agents/skills/coding-standards/SKILL.md) |
| Deduplication and DRY                      | [`coding-standards`](./.agents/skills/coding-standards/SKILL.md) |
| Non-interactive execution                  | [`tool-use-react`](./.agents/skills/tool-use-react/SKILL.md)     |

---

## 4. Current Work State

Active, in-flight task state and intra-task scratchpad context are maintained locally in `.agent-state.md` (gitignored).

- **On Session Startup**: If `.agent-state.md` exists, read it to discover active objectives and resume in-flight work without lost context across AI provider switches.
- **During Execution**: Update `.agent-state.md` when making progress, encountering blockers, or pausing a workflow.
- **Before starting anything substantial**: Check it is still accurate and correct it if not — a new issue, a release, a branch, a piece of work expected to take a while. "Feature completion" is a trigger a long session never reaches; a session that runs for days without one leaves the file describing the day it started. This is the checkpoint that actually fires.
- **On Feature Completion**: Clear/reset `.agent-state.md` once all objectives and DoD verifications are met.

**It is gitignored, so it holds no durable record.** Nothing in it survives the machine it is written on. Anything that would matter to someone else — a finding, a constraint, a decision and its reasoning — belongs on the issue it concerns, and only then in here. If a fact exists solely in `.agent-state.md`, it is one lost laptop from never having existed.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-20_ | _Last Reviewed: 2026-09-20_
