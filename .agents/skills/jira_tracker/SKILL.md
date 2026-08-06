---
name: jira-tracker
description: Guides agents on documenting, naming, and categorizing upstream bugs/limitations in the repository's JIRA issue tracker.
---

# JIRA Issue Tracker & Reporter Skill

This skill guides AI agents on how to document, organize, and track upstream platform limitations, core system bugs, or necessary API extensions as GitHub issues carrying the `JIRA` label.

## Lifecycle via Issue Title

Every upstream-bug issue is a normal GitHub issue labeled `JIRA`. Its lifecycle is tracked by the JIRA key in its title, not by file location:

- **Draft** (not yet raised on the JIRA platform): title starts with a placeholder key, e.g. `# LPD-XXXXX: Short Description`.
- **Registered** (raised on JIRA, key assigned): once the issue is filed on `liferay.atlassian.net`, rename the issue's title to replace the placeholder with the real key, e.g. `LPD-95079 - https://liferay.atlassian.net/browse/LPD-95079`, and add the real link on the line below the title per the template.
- **Resolved**: once the upstream issue is resolved or closed on JIRA, close the GitHub issue.

## Standard Issue Body Template

Every issue must use the following template in its body to guarantee high-quality, reproducible bug reports:

````markdown
# Liferay DXP Bug Report: [Short, Descriptive Title]

[JIRA-KEY] - https://liferay.atlassian.net/browse/[JIRA-KEY]

## Component

- **[Component Name, e.g., Headless Commerce]**
- **[Underlying Engine, e.g., Vulcan Batch Engine]**

## Environment

- **Liferay Product Version**: [e.g., Liferay DXP 2026.q1.7-lts]
- **API Endpoint**: [e.g., /o/headless-admin-user/v1.0/accounts/batch]

## Summary

[A concise overview of the limitation or bug, the context of occurrence, and its impact on development.]

## Description & Technical Analysis

[Detailed analysis of the system behavior, underlying exceptions, database query parameters, or class inheritance issues.]

## Steps to Reproduce

1. [Step 1]
2. [Step 2]
3. [Step 3 with code snippets or payloads]

```json
{
  "example": "payload"
}
```

## Expected Results

[Expected correct behavior of the API or system.]

## Workaround

[The precise implementation or configuration workaround deployed in this codebase to bypass the issue.]
````

## Agent Action Guidelines

When you discover an upstream bug or platform limitation:

1. **Create Draft**: Write a draft bug report following the template and file it with `gh issue create --label JIRA`, using a placeholder key (`LPD-XXXXX`) in the title.
2. **Implement Workaround**: Implement the necessary resilient logic or configuration workaround in the codebase, documenting it in the issue body.
3. **Register JIRA Key**: When the issue is raised on JIRA, use `gh issue edit <number> --title "..."` to replace the placeholder with the real key, and update the JIRA link in the body.
4. **Audit Statuses**: Periodically audit open `JIRA`-labeled issues (`gh issue list --label JIRA`). If one has been resolved or closed on JIRA, close the GitHub issue.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-03_ | _Last Reviewed: 2026-08-03_
