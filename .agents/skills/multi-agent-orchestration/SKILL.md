---
name: multi-agent-orchestration
description: Activate this skill when delegating tasks, defining subagents, or orchestrating parallel agentic workflows.
---

# Multi-Agent Orchestration & Workflow Guidelines

To improve efficiency and prevent the primary developer agent from becoming a bottleneck, workflows should utilize specialized subagents for concurrent execution.

## 1. Concrete Subagent Profiles

When delegating tasks, use the Agent tool (`subagent_type` + a self-contained `prompt`) to dispatch the following kinds of work:

- **Codebase research**: Use the `Explore` agent type to map out large existing codebases before major refactors — locating files, grepping for symbols, and summarizing architectural patterns.
- **Test writing**: Delegate to a general-purpose agent when writing a unit test suite is large enough to parallelize independently of the main feature work; it should run the project's real test/coverage commands (not invented ones) and ensure the 45% coverage gate is met.
- **Documentation audits**: Delegate reviewing and updating markdown files and their timestamp footers (per the `documentation` skill) to a general-purpose agent when the sweep spans many files.

## 2. Orchestration Constraints

The AI agent MUST adhere to the following Active Structural Constraints when managing multi-agent pipelines:

- **Subagent Invocation**: Before performing time-consuming, parallelizable tasks (e.g., broad codebase research, running a full test suite while writing code), dispatch the appropriate Agent call with a clear, self-contained objective. You are FORBIDDEN from performing these specialized tasks sequentially yourself if they can be delegated.
- **Asynchronous Synchronization**: After dispatching a background agent, do not poll for its result. Continue other parallelizable work (or respond to the user) — you'll be notified automatically when the agent completes.

## 3. Sequential Workflows

When implementing sequential multi-agent pipelines (where agents operate one after another), the AI agent MUST adhere to the following Active Structural Constraints:

- **Pipeline Setup**: Pass prior output artifacts (e.g., an implementation plan or research notes) directly in the next subagent's prompt as context — subagents share no memory of earlier turns.
- **Role Handoffs**: When an agent completes its task, its final report must explicitly state what the next agent should pick up, ensuring a seamless handoff (e.g., "The Planner has finished the design; the Implementer should now execute the code modifications").
- **Shared File State**: Sequential subagents operating on the same files must run in the same working directory (no isolated worktree) so each can see and build on the previous agent's file system changes.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-03_ | _Last Reviewed: 2026-08-03_
