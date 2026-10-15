# AICA Documentation

Everything here documents the **Liferay AI Commerce Accelerator (AICA)**: how to install it, how it works internally, and the platform behaviour it has to work around.

> [!NOTE]
> ℹ️ **Community project** — not an official Liferay product and not covered by Liferay Support. [About this project](./about.md)

AICA generates data **for** Liferay Commerce; it is not a commerce platform in its own right. If the platform itself is new to you, start with the [Liferay Commerce documentation](https://learn.liferay.com/w/dxp/commerce).

New to the project? Start with the **[Quick Start Guide](./QUICKSTART.md)**.

## I want to…

| I want to…                                               | Read                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Install AICA and generate my first catalog               | [Quick Start Guide](./QUICKSTART.md)                                                                                    |
| Run the seeder against an existing DXP, without LDM      | [Local Execution & Operations Guide](./LOCAL_EXECUTION.md)                                                              |
| Target a remote Liferay Experience Cloud (SaaS) instance | [SaaS Targeting Guide](./SaaS_TARGETING_GUIDE.md)                                                                       |
| See what AICA can actually generate                      | [Features & Capabilities](./FEATURES.md)                                                                                |
| Understand how a generation run flows through the system | [Architectural Overview](./ARCHITECTURE.md)                                                                             |
| Find which client extension owns a given responsibility  | [System Map](./SYSTEM_MAP.md)                                                                                           |
| Change what a generator asks the model for               | [Prompt Templates](./PROMPT_TEMPLATES.md)                                                                               |
| Drive AICA from an AI agent                              | [MCP Server](./MCP.md)                                                                                                  |
| Configure Liferay's API authentication                   | [JSON Web Services Guide](./JSONWS_GUIDE.md)                                                                            |
| Work on the shared SDK rather than AICA itself           | [LDK / Accelerator SDK Blueprint](./LDK_ARCHITECTURE.md)                                                                |
| Understand a Liferay bug AICA works around               | [Upstream Bugs & Limitations](./upstream-bugs/index.md)                                                                 |
| Follow the repository's automation and release rules     | [Automation Playbook](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/blob/master/docs/PLAYBOOK.md) |

## By subject

The table above routes on your question. This section lists the same documents
by what they cover, for when you would rather browse than search.

### Getting started

- **[Quick Start Guide](./QUICKSTART.md)** — deployment, configuration and execution, including the Sales Engineering Demo (LDM) path and manual developer setup.
- **[Features & Capabilities](./FEATURES.md)** — AI generation, real-time monitoring and visual assets, from a user's point of view.

### Running it

- **[Local Execution & Operations Guide](./LOCAL_EXECUTION.md)** — the runbook for executing AICA against an existing or restored DXP environment without LDM or `.ldmp` packages. The longest document here, and the one to read when something is misbehaving locally.
- **[SaaS Targeting Guide](./SaaS_TARGETING_GUIDE.md)** — running the seeder locally while targeting a remote Liferay Experience Cloud environment, including why this bypasses browser CORS entirely.
- **[MCP Server](./MCP.md)** — connecting an AI agent over SSE to inspect, monitor, generate and clean up datasets programmatically.
- **[Prompt Templates](./PROMPT_TEMPLATES.md)** — the nunjucks syntax available to whoever writes a prompt: variables, conditionals, loops and filters. Templates are editable in the Configuration UI, so a prompt changes without a build.

### How it works

- **[Architectural Overview](./ARCHITECTURE.md)** — the stateful workflow engine, entity dependencies, batch statuses, the WebSocket event contract and the security flows. Read this before the deep dives.
- **[System Map](./SYSTEM_MAP.md)** — each client extension as a subsystem, with its responsibilities and data flow.
- **[Architecture deep dives](./deep-dives/README.md)** — the detailed specifications behind the overview: orchestration, the microservice split, API constraints, workflow state and UI standards.
- **[LDK / Accelerator SDK Blueprint](./LDK_ARCHITECTURE.md)** — the decoupled `@liferay/accelerator-sdk` repository that AICA and other accelerators build on.

### Platform reference

- **[JSON Web Services Guide](./JSONWS_GUIDE.md)** — Liferay's `/api/jsonws` endpoints and when to prefer the Headless REST or GraphQL APIs instead.
- **[Upstream Bugs & Limitations](./upstream-bugs/index.md)** — upstream DXP bugs and undocumented behaviour that AICA has to accommodate, with current status for each.

### Project process

- **[Automation Playbook](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/blob/master/docs/PLAYBOOK.md)** — branch protection, release pipelines and automated backlog prioritisation, for maintainers and AI agents.

## Related Liferay tools

Three community tools by the same maintainer, each with its own documentation
site. None is an official Liferay product.

- **[Liferay Docker Manager (LDM)](https://peterrichards-lr.github.io/liferay-docker-manager/)**
  — runs Liferay DXP in containers and imports `.ldmp` packages. It is how the
  [Quick Start](./QUICKSTART.md) brings up an environment for AICA.
- **[lfr-tunnel](https://peterrichards-lr.github.io/lfr-tunnel/)** — exposes a
  local Liferay instance over a public URL, for webhooks and callbacks that
  cannot reach `localhost`.

## Related

- **[About these docs](./about.md)** — what this project is, what it is not, and how the dates on each page are produced and enforced.
- **[Repository README](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/blob/master/README.md)** — project overview and the `aica` CLI command suite.
- **[CONTRIBUTING](./contributing.md)** — how to propose and land a change.
- **[Code of Conduct](./code-of-conduct.md)** — the standards expected of everyone taking part.
- **[AGENTS.md](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/blob/master/AGENTS.md)** — the canonical context for AI agents working in this repository.

<!-- markdownlint-disable MD036 MD049 -->

---

_Last Reviewed: 2026-10-15_
