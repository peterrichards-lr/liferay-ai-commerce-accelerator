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

## 2. Command Execution

- **Non-Interactive Execution**: Always pass non-interactive flags (`-y`, `--non-interactive`) when running developer tools or CLI scripts. A command that stops for a prompt hangs the agent loop with no indication of why.

## 3. GitHub API Boundaries

All interactions with the GitHub platform MUST be mediated strictly through the native `gh` CLI.

- **Primary Tool Usage**: For all GitHub operations (e.g., creating issues, checking PRs, merging, syncing workflows), you MUST execute commands using the `gh` CLI via your terminal tools.
- **Prohibited APIs**: You are FORBIDDEN from using Python scripts, `curl`, or raw REST API wrappers to manipulate GitHub state.
- **Permission Exceptions**: If a `gh` command fails with a permission error requesting a specific grant, you MUST immediately halt, explain to the user exactly what permission is missing and why the command needs it, and wait for their approval (or for them to grant it) before retrying.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-18_ | _Last Reviewed: 2026-08-18_
