---
name: reflection-and-planning
description: Activate this skill when beginning complex tasks, proposing architectural changes, or modifying codebase files to ensure proper planning and predictive failure analysis.
---

# Reflection and Planning Pipelines

To ensure thoughtful decision-making and robust implementations, the AI agent MUST strictly adhere to the following Reflection and Planning constraints before and after task execution.

## 1. Mandatory Implementation Plans

Before making structural modifications or editing logic blocks larger than 10 lines across any files, you MUST outline your approach using a formalized implementation plan.

- **Plan Presentation**: You MUST present the implementation plan to the user (as chat output, or via plan mode where available) before touching any files.
- **Approval Gate**: You MUST wait for the user's explicit approval before proceeding.
- **Prohibited Execution**: You are FORBIDDEN from executing any code modifications using your file edit tools until the user responds explicitly with "Proceed" or approves the implementation plan.

## 2. Predictive Failure Analysis

Anticipating system failures before they happen is critical to stability. Whenever you finalize or execute code modifications, you MUST practice predictive failure analysis.

- **Required Output Section**: You MUST append a specific markdown section to your reasoning or visible output titled "Failure Analysis".
- **Analysis Content**: This section MUST detail exactly two explicit failure points (e.g., specific edge cases, unhandled promises, permission errors, or performance bottlenecks) related to the code you just wrote.
- **Mitigation Strategy**: You MUST explicitly describe exactly how your newly implemented code natively handles or mitigates these two predicted failure points.

## 3. Tracking a Change

The plan in §1 does not live only in chat. It lives on an issue, which is the
one place a decision survives the machine it was made on - `.agent-state.md` is
gitignored and holds no durable record.

### 3.1 An issue carries the analysis and the plan, before the PR

Raise it first, with the evidence and the intended approach, then open the PR
that closes it. An issue written after the fact is a changelog entry, not a
plan, and the reasoning that justified the approach is the part worth keeping.

### 3.2 Every repository that owns changed code gets its own issue

A change spanning this repo and the SDK needs an issue in each, not one issue
mentioning both. The repo that owns the code is the repo whose reader needs the
reasoning.

### 3.3 A PR that contributes to an issue without closing it

Some PRs advance an issue that must stay open - one instance of a class, one
half of a fix that spans two repositories, evidence added to an open
investigation. Reference it with `Refs` and leave it open.

**Where the issue should close but something is left over, raise a sub-issue
covering the remainder first.** If a PR resolves the immediate defect and
leaves the class, the generalisation, or a follow-up unaddressed, that residue
needs its own tracked home - otherwise closing the parent quietly discards it.

### 3.4 `no-issue-needed`

**Only for work too trivial to warrant a tracked issue.** A dependabot bump is
the standard case.

**Forbidden when implementing a tracked issue.** If an issue exists for the
work, link it. The label is for the absence of an issue, never a way around
one, and using it on work that has an issue records the opposite of the truth -
that the change was untracked when it was not.

The test is whether an issue would carry analysis and a plan. If there was none
to make, label it. If there was, §3.1 applies and the label does not.

**This is enforced.** `.github/workflows/issue-link-check.yml` fails a PR that
references no issue and carries no override label. It accepts `Refs` as well as
`Closes`, deliberately: a PR advancing an issue that must stay open is a normal
case here, and forcing those towards this label would misrecord them as
untracked.

### 3.5 `Closes` versus `Refs`

- **`Closes #N`** - this PR resolves that issue in full. It will be closed
  automatically on merge, so use it only when nothing is left.
- **`Refs #N`** - this PR relates to that issue, contributes evidence, or fixes
  an instance of a class it names, but does not resolve it.

Using `Closes` for a partial fix is the mechanism by which a class becomes a
series of instances: the issue that named the class disappears with the first
instance fixed.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-28_ | _Last Reviewed: 2026-09-28_
