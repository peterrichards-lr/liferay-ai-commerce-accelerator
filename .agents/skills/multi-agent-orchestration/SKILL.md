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

## 4. Review by Subagent

Sections 1-3 are about throughput. This one is not: it is the step that closes
out non-trivial work.

Four reviews were run in the week to 2026-09-27 and **all four found real
defects**, including in work that had been break-tested and declared clean. One
found a redaction filter that was *worse* than the one it replaced, on a commit
whose message said the class had been retired.

### 4.1 When to dispatch a reviewer

Before declaring work complete, when any of these hold:

- The change adds or strengthens a guard, an assertion, or a CI check.
- **You have break-tested it yourself and are about to call it clean.** Self-testing
  is when a reviewer is most valuable, not least: you test against the perturbation
  you expected, and the same anchoring that hid the defect shaped the test for it.
- A diagnosis has been revised more than once. By the second revision, stop
  re-diagnosing and have something else re-derive it from the artifact.
- The change spans a boundary - host and container, local and remote, writer and
  reader.

### 4.2 What the reviewer is given, and what is withheld

Give it the diff, the artifact (log, capture, test output), and the requirement
from the issue.

**Withhold your conclusion, your commit message, and your verdict.** The method
that works is having something re-derive the answer from the evidence without
being told what it is. This is not ceremony: in one review two of three defects
*contradicted their own commit messages*, so a reviewer handed the message
inherits the frame that hid the defect. In another, a reviewer given only the
artifact produced a failure grouping different from the one already believed,
and the new one was right.

Ask for a verdict the reviewer must derive. Never one it can simply agree with.

### 4.3 What to ask

One falsifiable question per guard, never "does this look right":

- **"For each guard in this diff, name the line that would have to change for it
  to fail."** No such line means the guard is decorative. This single question has
  found guards that had been break-tested against the wrong perturbation.
- "Which assertion here would still pass if the feature were deleted?"
- "Does any check run after the thing it inspects is gone?"
- "Does any check read source text that a comment could satisfy?" (see #1172)
- "Where does a code comment hedge while the operator-facing message asserts?"

### 4.4 What a reviewer is not for

Not for redoing the work, and not for approval.

A reviewer that returns "looks good" was not given a question it could answer
with evidence - reissue it with one. And a reviewer's finding is a claim to check
against the artifact, not a verdict to adopt: it carries no more authority than
the conclusion it is checking. Verify the consequential ones yourself before
acting on them.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-28_ | _Last Reviewed: 2026-09-28_
