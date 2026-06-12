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

1. **Create a Branch**: Always branch from `master` (or `main`) and name it logically:

   ```bash
   git checkout -b feat/add-new-generator
   ```

2. **Commit Changes**: Ensure your commit messages are conventional and all linting/testing passes.
3. **Sync with Upstream**: Keep your branch up to date:

   ```bash
   git fetch upstream
   git rebase upstream/master
   ```

4. **Push & PR**: Push to your fork and submit a PR to the upstream repository. Ensure you describe **what** changed and **why** (include test logs or manual steps to verify).

Thank you for contributing!
