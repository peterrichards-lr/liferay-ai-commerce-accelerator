# Setup & Deployment Guide

This guide covers the necessary steps to deploy and run the Liferay AI Commerce Accelerator.

## Prerequisites

- Liferay DXP 7.4+
- Node.js 22.12.0+
- Yarn 1.22+
- Liferay Blade CLI

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

```bash
(rm -f client-extensions/ai-commerce-accelerator-microservice/logs/*.log || true) && blade gw :client-extensions:ai-commerce-accelerator-microservice:clean :client-extensions:ai-commerce-accelerator-microservice:deploy :client-extensions:ai-commerce-accelerator-microservice:packageRunDebug
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

## Initial Configuration

Once deployed, follow these steps to configure the accelerator:

1.  Navigate to the **AI Commerce Accelerator Configuration** in the Liferay application menu.
2.  Configure your **AI Provider Settings** (OpenAI, Gemini, or Nano Banana).
3.  Ensure your **API Keys** are correctly set for both Text and Media generation.
4.  Verify that the **Categories** and **AI Model Options** are populated.
