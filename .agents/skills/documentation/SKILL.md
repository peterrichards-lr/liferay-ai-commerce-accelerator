---
name: documentation
description: Activate this skill after implementing code changes to verify, review, and update markdown documentation and timestamps.
---

# Documentation & Timestamp Hygiene Rules

To prevent documentation decay and ensure system configuration and architectural changes are accurately recorded, follow these active rules:

## 1. Proactive Documentation Review

After implementing any code change, the agent MUST review the project's documentation (e.g., markdown files under the root or subdirectories) to see if updates are required.

- **If no changes are needed**: The agent must still update the `*Last Reviewed: YYYY-MM-DD*` footer timestamp in the reviewed document to the current date.
- **If updates are required**: The agent must update the documentation content and change both `*Last Updated: YYYY-MM-DD*` and `*Last Reviewed: YYYY-MM-DD*` footer timestamps to the current date.
- **Scope**: A single code change may require updates to more than one document.

## 2. Missing Documentation

- If no documentation exists around the newly implemented change/feature, and it makes sense to document it (e.g., for architectural details, deployment instructions, or API usage), the agent should create a new Markdown document (`.md` file).
- If the new details fit better inside an existing document, add them as a new section or update existing sections accordingly.

## 3. Footer Formatting Standards

Every created or modified Markdown file must end with a footer block in the exact format:

```markdown
<!-- markdownlint-disable MD049 -->

---

_Last Updated: YYYY-MM-DD_ | _Last Reviewed: YYYY-MM-DD_
```

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-20_ | _Last Reviewed: 2026-07-20_
