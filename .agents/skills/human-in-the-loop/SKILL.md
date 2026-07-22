---
name: human-in-the-loop
description: Activate this skill before opening pull requests, modifying production configurations, or executing deployment and destructive commands to ensure proper human-in-the-loop verification.
---

# Human-in-the-Loop Integrations

To prevent destructive automated actions and ensure test-driven stability, the AI agent MUST strictly adhere to the following stop-and-wait verification gates before taking critical actions.

## 1. Pull Request Verification Gates

Before finalizing and opening a Pull Request on GitHub, you MUST obtain explicit confirmation from the human developer that local checks are passing.

- **The Test Check**: Before executing `gh pr create` or submitting a pull request, you MUST explicitly ask the user: _"Are all tests passing locally?"_
- **The Wait Constraint**: You MUST END your turn immediately after asking the question. You are FORBIDDEN from executing the PR creation command until the human user responds explicitly with an affirmative (e.g., "Yes").

## 2. Deployment & Destructive Task Gates

Any operations that irreversibly alter external state, infrastructure, or databases MUST be explicitly verified.

- **The Deployment Check**: Before executing any command that deploys code, drops databases, runs structural migrations, or pushes to non-feature branches, you MUST explicitly ask the user: _"Are you sure you want to proceed with [action]?"_
- **The Wait Constraint**: You MUST END your turn immediately after asking the question and await explicit approval.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-22_ | _Last Reviewed: 2026-07-22_
