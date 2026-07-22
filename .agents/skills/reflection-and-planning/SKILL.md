---
name: reflection-and-planning
description: Activate this skill when beginning complex tasks, proposing architectural changes, or modifying codebase files to ensure proper planning and predictive failure analysis.
---

# Reflection and Planning Pipelines

To ensure thoughtful decision-making and robust implementations, the AI agent MUST strictly adhere to the following Reflection and Planning constraints before and after task execution.

## 1. Mandatory Implementation Plans

Before making structural modifications or editing logic blocks larger than 10 lines across any files, you MUST outline your approach using a formalized implementation plan.

- **Artifact Creation**: You MUST explicitly output an implementation plan using an `implementation_plan.md` artifact.
- **Approval Gate**: You MUST set `request_feedback=true` on the artifact, stop calling tools, and END your turn to await user approval.
- **Prohibited Execution**: You are FORBIDDEN from executing any code modifications using your file edit tools until the user responds explicitly with "Proceed" or approves the implementation plan.

## 2. Predictive Failure Analysis

Anticipating system failures before they happen is critical to stability. Whenever you finalize or execute code modifications, you MUST practice predictive failure analysis.

- **Required Output Section**: You MUST append a specific markdown section to your reasoning or visible output titled "Failure Analysis".
- **Analysis Content**: This section MUST detail exactly two explicit failure points (e.g., specific edge cases, unhandled promises, permission errors, or performance bottlenecks) related to the code you just wrote.
- **Mitigation Strategy**: You MUST explicitly describe exactly how your newly implemented code natively handles or mitigates these two predicted failure points.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-22_ | _Last Reviewed: 2026-07-22_
