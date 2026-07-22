---
name: tool-use-react
description: Activate this skill when making tool calls, interacting with the terminal, or invoking GitHub APIs to ensure strict ReAct patterns are followed.
---

# Tool Use and ReAct Patterns

To ensure methodical, secure, and predictable interactions with the underlying filesystem and APIs, the AI agent MUST strictly adhere to the following ReAct (Reasoning and Acting) constraints.

## 1. Explicit Reasoning (ReAct)

Before executing any tool call, you MUST output an explicit reasoning block outlining your rationale.

- **Reasoning Requirement**: You are FORBIDDEN from impulsively executing tool calls without first generating an explicit internal reasoning step. This step MUST clarify:
  1. What exact information or action is needed.
  2. Why the selected tool is the most specific and appropriate mechanism.
  3. Any potential side-effects or edge-cases of the invocation.

## 2. GitHub API Boundaries

All interactions with the GitHub platform MUST be mediated strictly through the native `gh` CLI.

- **Primary Tool Usage**: For all GitHub operations (e.g., creating issues, checking PRs, merging, syncing workflows), you MUST execute commands using the `gh` CLI via your terminal tools.
- **Prohibited APIs**: You are FORBIDDEN from using Python scripts, `curl`, or raw REST API wrappers to manipulate GitHub state.
- **Permission Exceptions**: If a `gh` command fails with a permission error requesting a specific grant (e.g. `To allow this command, you likely need grant: gh.update(...)`), you MUST immediately halt and explicitly use your system's permission-granting mechanism (e.g., `ask_permission` with the required `Target`) and await user approval before proceeding.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-22_ | _Last Reviewed: 2026-07-22_
