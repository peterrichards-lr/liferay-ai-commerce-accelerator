# AI Commerce Accelerator Agent Skills Directory

To prevent cognitive overload and ensure passive rules are not missed during execution, the project's agent rules are refactored into active, modular skill files located under `.agents/skills/`.

Please reference the specific skill file based on the context of your task:

## Table of Contents

| Skill Name                                                                                 | Path                                                                                                           | Trigger Condition / When to Load                                                | Description                                                                                  |
| :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| **[e2e-verification](file:///.agents/skills/e2e-verification/SKILL.md)**                   | [.agents/skills/e2e-verification/SKILL.md](file:///.agents/skills/e2e-verification/SKILL.md)                   | When verifying changes, running E2E tests, or checking DoD.                     | Governs E2E testing commands, container setups, and DoD check procedures.                    |
| **[client-extension-routing](file:///.agents/skills/client-extension-routing/SKILL.md)**   | [.agents/skills/client-extension-routing/SKILL.md](file:///.agents/skills/client-extension-routing/SKILL.md)   | When editing YAML configuration files.                                          | Enforces guardrails preventing manual serviceAddress modifications in client-extension.yaml. |
| **[build-environment](file:///.agents/skills/build-environment/SKILL.md)**                 | [.agents/skills/build-environment/SKILL.md](file:///.agents/skills/build-environment/SKILL.md)                 | When editing lockfiles, package configurations, or gradle tasks.                | Handles Node.js/Vite versions pinning, Yarn locks rules, and Gradle cache cleanups.          |
| **[coding-standards](file:///.agents/skills/coding-standards/SKILL.md)**                   | [.agents/skills/coding-standards/SKILL.md](file:///.agents/skills/coding-standards/SKILL.md)                   | When writing or refactoring microservice/SDK source code.                       | Defines self-documenting code style, dry-run profiling, and native identifier practices.     |
| **[quality-guardrails](file:///.agents/skills/quality-guardrails/SKILL.md)**               | [.agents/skills/quality-guardrails/SKILL.md](file:///.agents/skills/quality-guardrails/SKILL.md)               | When modifying service layers or preparing to commit changes.                   | Verifies service parity, bootstrap verifySteps checks, and Husky pre-commit setups.          |
| **[platform-findings](file:///.agents/skills/platform-findings/SKILL.md)**                 | [.agents/skills/platform-findings/SKILL.md](file:///.agents/skills/platform-findings/SKILL.md)                 | When troubleshooting API errors or seeding database engines.                    | Outlines quirks on sequencing, productType constraints, SKU active rules, and indexing.      |
| **[documentation](file:///.agents/skills/documentation/SKILL.md)**                         | [.agents/skills/documentation/SKILL.md](file:///.agents/skills/documentation/SKILL.md)                         | After implementing any code changes.                                            | Details active documentation review, creation, and timestamp hygiene rules.                  |
| **[multi-agent-orchestration](file:///.agents/skills/multi-agent-orchestration/SKILL.md)** | [.agents/skills/multi-agent-orchestration/SKILL.md](file:///.agents/skills/multi-agent-orchestration/SKILL.md) | When delegating tasks or defining subagents.                                    | Orchestrates parallel workflows and delegates to specialized subagents.                      |
| **[tool-use-react](file:///.agents/skills/tool-use-react/SKILL.md)**                       | [.agents/skills/tool-use-react/SKILL.md](file:///.agents/skills/tool-use-react/SKILL.md)                       | When making tool calls, interacting with the terminal, or invoking GitHub APIs. | Enforces ReAct reasoning patterns and strict GitHub CLI usage boundaries.                    |
| **[reflection-and-planning](file:///.agents/skills/reflection-and-planning/SKILL.md)**     | [.agents/skills/reflection-and-planning/SKILL.md](file:///.agents/skills/reflection-and-planning/SKILL.md)     | When beginning complex tasks or modifying codebase files.                       | Enforces mandatory implementation plans and predictive failure analysis.                     |

---

## Architectural Documentation

Please refer to the following documentation in `docs/architecture/` for detailed system constraints and architectural rules:

- [Workflow & Batching (WebSocket, Correlation, Media)](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/architecture/workflow-and-batching.md)
- [Liferay API Constraints (OData, DTOs, Pricing, Glue)](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/architecture/liferay-api-constraints.md)
- [E2E & Orchestration (LDM, Deployment Patterns)](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/architecture/e2e-and-orchestration.md)
- [Frontend & UI Standards (Stylebook, UI/UX)](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/architecture/frontend-and-ui.md)
- [Microservice Architecture (SDK, Storage, Providers)](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/architecture/microservice-architecture.md)

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-20_ | _Last Reviewed: 2026-07-20_
