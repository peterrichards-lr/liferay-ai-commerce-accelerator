---
name: multi-agent-orchestration
description: Activate this skill when delegating tasks, defining subagents, or orchestrating parallel agentic workflows.
---

# Multi-Agent Orchestration & Workflow Guidelines

To improve efficiency and prevent the primary developer agent from becoming a bottleneck, workflows should utilize specialized subagents for concurrent execution.

## 1. Concrete Subagent Profiles

When delegating tasks, use the `define_subagent` and `invoke_subagent` tools to create and manage the following profiles:

- **`Codebase Researcher`**:
  - **Role**: Dedicated to mapping out large existing codebases before major refactors.
  - **Tasks**: Runs `grep_search` and `view_file` to collect context, read documentation, and summarize architectural patterns.

- **`Test Specialist`**:
  - **Role**: Dedicated to writing unit test suites and enforcing coverage gates.
  - **Tasks**: Generates test files, runs `Vitest` coverage commands, and ensures the strict 45% coverage gate is met independently of feature development.

- **`Documentation Auditor`**:
  - **Role**: Dedicated to reviewing and maintaining project documentation.
  - **Tasks**: Reviews markdown files, updates timestamps (using the `append_timestamps.py` or `check_docs_review.py` scripts), and formats documentation.

## 2. Orchestration Constraints

The AI agent MUST adhere to the following Active Structural Constraints when managing multi-agent pipelines:

- **Subagent Invocation**: Before performing time-consuming, parallelizable tasks (e.g., broad codebase research, running a full test suite while writing code), you MUST explicitly execute `invoke_subagent` to spawn the appropriate profile (`Codebase Researcher`, `Test Specialist`, or `Documentation Auditor`), assign them a clear objective, and END your turn. You are FORBIDDEN from performing these specialized tasks sequentially if they can be delegated.
- **Asynchronous Synchronization**: After invoking a subagent, you MUST NOT use loop-polling to wait for completion. You MUST proceed with other parallelizable work or END your turn to yield to the system until you receive an asynchronous message containing the subagent's result.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-22_ | _Last Reviewed: 2026-07-22_
