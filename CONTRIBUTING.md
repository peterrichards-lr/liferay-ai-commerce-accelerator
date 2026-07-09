# Contributing to Liferay AI Commerce Accelerator

Thank you for your interest in contributing to the **Liferay AI Commerce Accelerator**! Contributions from the team and community are what make this project successful.

By contributing to this repository, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🚀 Getting Started

### 1. Prerequisites

Ensure you have the following installed on your local machine:

- **Node.js** (v22.x or later, managed via `.nvmrc`)
- **Yarn** (v1.22.x)
- **Java** (v17 or v21, required for Liferay Workspace/Gradle)
- **Docker** (Required for the LLD/LDM local server stacks)
- **Liferay Docker Manager (LDM)** (`npm install -g @google/gemini-cli` or similar developer setup)

### 2. Fork & Clone

1. Fork the repository on GitHub.
2. Clone your fork locally:

   ```bash
   git clone https://github.com/YOUR-USERNAME/liferay-ai-commerce-accelerator.git
   cd liferay-ai-commerce-accelerator
   ```

3. Set up the upstream remote:

   ```bash
   git remote add upstream https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator.git
   ```

---

## 🛠️ Development Workflow

We use a **monorepo** structure managed by Gradle (Liferay Workspace) with Node/Yarn workspaces under `client-extensions/`.

### 📦 Project Structure

- `/client-extensions/ai-commerce-accelerator-frontend/` — React SPA Dashboard
- `/client-extensions/ai-commerce-accelerator-microservice/` — Node/Express Backend API
- `/client-extensions/ai-commerce-accelerator-configuration/` — OSGi Caddy configuration element
- `/client-extensions/liferay-accelerator-sdk/` — Shared SDK for Liferay APIs & contracts

### 🔨 Compilation and Building

To install all dependencies and build all client extensions in one command, run from the root:

```bash
./gradlew deploy
```

This deploys compiled client extension `.zip` archives into `/bundles/osgi/client-extensions/` ready for Liferay.

### 🧪 Running Unit Tests

All packages have dedicated Vitest suites. You can run the entire unit test suite across all subprojects:

```bash
./gradlew test
```

Or run them directly inside a specific folder (e.g. `client-extensions/liferay-accelerator-sdk`):

```bash
yarn test
```

### 🛡️ End-to-End (E2E) Testing

We use **Liferay Docker Manager (LDM)** and **Playwright** to run comprehensive E2E tests against a real DXP container. To run the full E2E suite locally:

```bash
LIFERAY_API_PASSWORD=test LIFERAY_API_USERNAME=test@liferay.com bash scripts/run-e2e-ldm.sh -v -k
```

---

## 📐 Styling & Standards

To ensure consistency, we enforce strict linting, formatting, and commit rules.

### Code Formatting

We use **Prettier** and **ESLint**. Code is automatically formatted and validated during git commits via **Husky** and **lint-staged**.
You can format your changes manually:

```bash
yarn lint
```

### Commit Messages

We enforce [Conventional Commits](https://www.conventionalcommits.org/). Commit messages must follow this structure:

```text
<type>(<scope>): <description>

[optional body]
```

**Allowed types:**

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Formatting, missing semi-colons, etc. (no production code change)
- `refactor`: Refactoring production code (neither fixes a bug nor adds a feature)
- `test`: Adding missing tests or correcting existing tests
- `chore`: Updating grunt tasks, build configurations, etc. (no production code change)

---

## 📥 Submitting a Pull Request

1. **Create a Branch**: Always branch from `master` and name it logically matching the Conductor Track IDs:

   ```bash
   git checkout -b feature/persona-orders
   ```

2. **Commit Changes**: Ensure your commit messages are conventional and all linting/testing passes.
3. **Sync with Upstream**: Keep your branch up to date:

   ```bash
   git fetch upstream
   git rebase upstream/master
   ```

4. **Push & PR**: Push to your fork and submit a PR to the upstream repository. Ensure you describe **what** changed and **why** (include test logs or manual steps to verify).

---

## 🛡️ Repository Branching & PR Rulesets (Strict Gates)

To maintain absolute code quality, stability, and a logical git history as the accelerator expands, this repository enforces the following strict engineering gates:

### 1. Feature Branch Isolation

- Direct pushes to the remote `master` branch are strictly prohibited for new roadmap items.
- All new developments, refactoring, or track features MUST be developed on isolated branches named `feature/<track-id>` (matching active items in the [Conductor Tracks Registry](conductor/tracks.md), e.g., `feature/persona-orders`).

### 2. Local Pre-flight Gatekeeper (`verify:all`)

- Before pushing any branch or opening/updating a Pull Request, developers (and AI assistants) **MUST** execute the local E2E validation pipeline:

  ```bash
  LIFERAY_API_PASSWORD=test LIFERAY_API_USERNAME=test@liferay.com bash scripts/run-e2e-ldm.sh -v -k
  ```

  This validates static linting, schema validation, contract compliancy, all unit tests, and Playwright E2E suites. **PRs will not be approved unless the local run reports a perfect 100% green pass.**

### 3. Squash and Merge Policy

- All Pull Requests merged into `master` **MUST** be squashed into exactly **one** linear commit.
- This keeps our master git log clean, logical, and highly parseable.

### 4. Squash Message Conventional Spec

- The final squashed commit message upon PR merge must follow conventional spec mapping to the track or component scope:

  ```text
  feat(<track-id>): brief summary of what was added

  - Detail 1 of change
  - Detail 2 of change
  ```

  _(e.g., `feat(persona-orders): implement intelligent AI persona order seeding`)_

---

Thank you for contributing!

<!-- markdownlint-disable MD049 -->
---
*Last Updated: 2026-07-08* | *Last Reviewed: 2026-07-08*
