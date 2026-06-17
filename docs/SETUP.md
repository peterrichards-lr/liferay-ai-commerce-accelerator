# Setup & Deployment Guide

This guide covers the necessary steps to deploy and run the Liferay AI Commerce Accelerator.

## Prerequisites

- Liferay DXP 7.4+
- Node.js 22.12.0+
- Yarn 1.22+
- Liferay Blade CLI

### Required Feature Flags

To support automated scaffolding of site pages and template linking, this project requires the following Feature Flag to be enabled in Liferay:

- **LPD-35443 (Page Management API)**: Enables REST APIs to create, read, and manage pages and page templates via External Reference Codes (ERCs).

How to enable it:

- **Standalone Bundle**: Add `feature.flag.LPD-35443=true` to your `portal-ext.properties` file and restart Liferay.
- **Liferay Docker Manager (LDM)**: Handled automatically on startup. If starting containers manually, use `ldm run --feature LPD-35443`.

## Deployment

To ensure that the application functions correctly, it is critical to deploy all client extensions to your Liferay instance. This is especially important for the `ai-commerce-accelerator-batch` extension, which contains the necessary data definitions for the Liferay Objects used by the accelerator.

### Full Deployment

To perform a full, clean deployment of all client extensions, run the following command from the root of the project:

```bash
blade gw clean deploy
```

This command will build all the client extensions and deploy them to your Liferay instance.

### `generateBatchFiles` Task

This project includes a Gradle task called `generateBatchFiles` that automatically creates batch files for AI schemas and prompts. These generated files are placed in the `client-extensions/ai-commerce-accelerator-batch/batch/` directory and are then deployed to Liferay as part of the `ai-commerce-accelerator-batch` client extension.

**Important:** The `ai-schemas` and `prompts` located in the `ai-commerce-accelerator-microservice` project are the single source of truth. If you need to make changes to the schemas or prompts, you should edit the files in these directories. The `generateBatchFiles` task will automatically update the batch files in the `ai-commerce-accelerator-batch` project when you build and deploy the project.

### Microservice-Only Deployment (Development)

For development purposes, you can deploy and run the microservice independently. However, be aware that this will not deploy the other client extensions, and you may encounter errors if the object definitions in your Liferay instance are not up-to-date.

When running locally outside of LDM (which normally configures secure environment proxy trust), you will need to bypass local self-signed SSL certificate checking by prepending `NODE_TLS_REJECT_UNAUTHORIZED=0`:

```bash
(rm -f client-extensions/ai-commerce-accelerator-microservice/logs/*.log || true) && NODE_TLS_REJECT_UNAUTHORIZED=0 blade gw :client-extensions:ai-commerce-accelerator-microservice:clean :client-extensions:ai-commerce-accelerator-microservice:deploy :client-extensions:ai-commerce-accelerator-microservice:packageRunDebug
```

## Automated Verification (Recommended)

To verify the entire stack (Microservice, Frontend, and Liferay Integration) in a clean environment, use the provided LDM orchestrator:

```bash
./scripts/run-e2e-ldm.sh
```

### Advanced Orchestrator Flags

- `-p <name>`: Target an existing project instead of creating a fresh one.
- `-k`: Keep the environment running after the tests finish (bypasses automatic cleanup).
- `-v`: Verbose mode to print all realized commands.
- _Env Vars_: Prepend `LIFERAY_USER=... LIFERAY_PASSWORD=...` to use custom credentials.

### LDM Configuration

When creating a fresh ephemeral environment (i.e. without the `-p` flag), the orchestrator uses the following specific LDM configurations:

- `--db postgresql`: Bypasses the mandatory password reset prompt enforced by the default in-memory Hypersonic database on first login, allowing automated Playwright authentication to succeed without interruption.
- `--sidecar`: Speeds up artifact synchronization and deployment monitoring.
- `--no-captcha`: Disables CAPTCHA enforcement for administrative actions.

### Requirements

- **LDM >= 2.5.4**: [Installation Guide](https://github.com/peterrichards-lr/liferay-docker-manager)
- **Docker Desktop**: Running with at least 8GB RAM.
- **mkcert**: Required for local SSL.

### Visual Verification

After a successful run (or failure), you can find visual snapshots of each responsive state in the `test-results/` directory. This allows for manual auditing of component display on Desktop, iPhone, Pixel, and iPad devices.

## Packaging & Importing LDM Environments (.ldmp)

Liferay Docker Manager Packages (`.ldmp`) allow you to distribute self-contained, lightweight, and fully-seeded development and demo environments.

### 📦 Building a Local .ldmp Package

To package the entire AICA suite—including your active PostgreSQL `aica-db` database state, dynamic document uploads, and configuration files—into a single `.ldmp` bundle (approx. 22MB), run the following automated script:

```bash
./scripts/package-ldmp.sh
```

This will output:

- `liferay-ai-commerce-accelerator.ldmp`: The unified, compressed environment archive.
- `liferay-ai-commerce-accelerator.ldmp.sha256`: The portable SHA-256 checksum file used to authenticate the package.

_Note: These files are automatically ignored by git inside `.gitignore` so they won't contaminate your repository._

### 📥 Importing and Launching a Local Package

Once you have compiled or received a `liferay-ai-commerce-accelerator.ldmp` package:

- **Import and boot the stack automatically:**

  ```bash
  ldm import /path/to/liferay-ai-commerce-accelerator.ldmp
  ```

- **Import without running (to inspect files or config first):**

  ```bash
  ldm import /path/to/liferay-ai-commerce-accelerator.ldmp --no-run
  ```

- **Starting the stack later:** If you imported with `--no-run` or stopped the container, spin it up using:

  ```bash
  ldm run liferay-ai-commerce-accelerator
  ```

### 🌐 Importing Directly from GitHub (Remote Extraction)

LDM supports a robust, remote-cloning and extraction pipeline that queries a GitHub repository's latest Release, downloads the `.ldmp` package and its `.ldmp.sha256` signature, verifies the checksum, and boots the environment in a single command.

To test this remote import logic:

```bash
ldm import https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator
```

On execution, LDM will:

1. Fetch and parse the latest release assets from the targeted GitHub repository.
2. Download both the `.ldmp` package and the `.ldmp.sha256` signature.
3. Validate the SHA-256 signature to guarantee complete package integrity.
4. Extract the configuration, database, and volume assets, and launch the production-parity container stack!

## Continuous Integration (GitHub Actions)

The project includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that automatically runs linting, unit tests, and E2E verification on every push and PR.

### GitHub Secrets

To allow the CI pipeline to perform full E2E verification with Liferay and AI generation, you must configure the following **GitHub Secrets** in your repository:

| Secret Name                   | Description                              | Default (if unset) |
| :---------------------------- | :--------------------------------------- | :----------------- |
| `LIFERAY_USER`                | Admin email for the Liferay instance     | `test@liferay.com` |
| `LIFERAY_PASSWORD`            | Admin password                           | `L1feray$`         |
| `OPENAI_API_KEY`              | API Key for OpenAI generation            | (Disabled)         |
| `GEMINI_API_KEY`              | API Key for Google Gemini generation     | (Disabled)         |
| `ANTHROPIC_API_KEY`           | API Key for Anthropic Claude             | (Disabled)         |
| `LIFERAY_OAUTH_CLIENT_ID`     | Custom OAuth2 Client ID for microservice | (Auto-resolved)    |
| `LIFERAY_OAUTH_CLIENT_SECRET` | Custom OAuth2 Client Secret              | (Auto-resolved)    |

### Skipping E2E in CI

Since E2E verification is resource-intensive, you can skip it by including `[ldm-skip]` in your commit message or PR title. Unit tests and linting will still run.

## Initial Configuration

Once deployed, follow these steps to configure the accelerator:

1.  Navigate to the **AI Commerce Accelerator Configuration** in the Liferay application menu.
2.  Configure your **AI Provider Settings** (OpenAI, Gemini, or Nano Banana).
3.  Ensure your **API Keys** are correctly set for both Text and Media generation.
4.  Verify that the **Categories** and **AI Model Options** are populated.

## Troubleshooting & Account Lockouts

### 401 Unauthorized Loop (Account Lockout)

Liferay DXP enforces a strict security policy that locks out user accounts (including administrators like `test@liferay.com`) after **5 failed login attempts**.

During automated E2E testing or local hot-deployment, if the test runner or CLI polls Liferay before the authentication modules are fully active, those early connection attempts register as failed logins. This quickly locks out `test@liferay.com`, resulting in a perpetual `Object API not ready (401)` wait loop in the orchestrator console.

#### 🛠️ Automated Recovery

The E2E Test Orchestrator (`test-e2e-orchestrator.js`) has **built-in auto-recovery** logic. If it detects a `401 Unauthorized` response during its readiness poll, it will automatically attempt to execute a database query inside the `aica-db` Docker container to unlock the admin user.

#### 🔧 Manual Recovery

If you need to manually unlock the user (or are running outside the standard orchestrator), execute the following PostgreSQL query directly in the `aica-db` container:

```bash
docker exec -it -e PAGER=cat aica-db psql -U lportal -d lportal -c "UPDATE user_ SET lockout = false, lockoutDate = null, failedLoginAttempts = 0 WHERE emailaddress = 'test@liferay.com';"
```

If running against a standalone local Liferay bundle, execute the equivalent SQL query against your local database (e.g. Hypersonic, MySQL, or MariaDB).

### Harmless `OptimisticLockException` / `StaleObjectStateException` Logs

During initial boot or rapid CLI verification runs, you may notice the following exception block inside your Liferay Tomcat console or docker logs:

```text
com.liferay.portal.kernel.exception.SystemException: com.liferay.portal.kernel.dao.orm.ORMException: jakarta.persistence.OptimisticLockException: Row was updated or deleted by another transaction (or unsaved-value mapping was incorrect) : [com.liferay.portal.model.impl.UserImpl#20132]
```

#### 💡 Why This Happens (And Why It Is Safe)

- **The Cause:** Every failed connection attempt before Liferay has finished hot-deploying the authentication configurations (or during credential mismatches) instructs Liferay to increment the `failedLoginAttempts` counter on the `test@liferay.com` database row to track security policies.
- **The Race Condition:** Because our CLI, microservice, and Playwright tests poll concurrently, **multiple requests attempt to update this exact same User database row at the exact same millisecond**. One transaction commits first, incrementing Hibernate's version counter, causing the other parallel transaction to fail with an `OptimisticLockException` to prevent data collision.
- **The Verdict:** **This exception is entirely harmless and expected.** It has no impact on Liferay's commerce, product, or account databases. Once the system has fully booted and authenticated, these exceptions will naturally stop, and our E2E self-healing orchestrator immediately clears any resulting lockouts from the database.
