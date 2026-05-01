# Liferay AI Commerce Accelerator - Getting Started

This guide provides instructions for setting up and developing the Liferay AI Commerce Accelerator suite.

## 1. Prerequisites

- **Node.js**: v22+ (LTS recommended)
- **Liferay DXP/Portal**: 7.4+
- **AI Credentials**: Required for AI-powered generation (optional for Demo Mode). Supports OpenAI, Google Gemini, and Anthropic Claude.

## 2. Workspace Setup

The project uses a multi-module Liferay Workspace. Core accelerator components are located in `client-extensions/`.

### Initial Installation

Run from the root directory:

```bash
npm install
```

## 3. Subsystem Development

### 🚀 Microservice (`ai-commerce-accelerator-microservice`)

The central orchestrator for data generation.

**Setup**:

```bash
cd client-extensions/ai-commerce-accelerator-microservice
npm install
npm start
```

_The service will start on `http://localhost:3001`._

### 🖥️ Frontend (`ai-commerce-accelerator-frontend`)

The React-based user interface.

**Setup**:

```bash
cd client-extensions/ai-commerce-accelerator-frontend
npm install
npm run dev
```

_The UI will be available at `http://localhost:5173`._

## 4. Testing & Quality Control

### Running Unit Tests

You can run tests for all components from the root:

```bash
npm test
```

Or individually within each component directory using `npm test`.

### Linting & Formatting

The project enforces strict style rules using ESLint and Prettier.

```bash
# Check for issues
npm run lint

# Fix automatic issues
npm run lint:fix
```

### Smoke Tests (E2E)

Cross-component verification using Playwright:

```bash
npx playwright test
```

## 5. Liferay Object Configuration

The accelerator uses a Liferay Object called `AI Commerce Accelerator Configuration` to store its settings. To ensure this works correctly:

1.  **Deployment**: Ensure the `ai-commerce-accelerator-batch` client extension is deployed to your Liferay instance.
2.  **Activation**: Go to **Control Panel -> Objects** and verify that `AI Commerce Accelerator Configuration` is **Active**.
3.  **Search Indexing**: If you receive `400 Bad Request` or empty results when saving settings, you may need to reindex. Go to **Control Panel -> Search -> Index Actions** and run **Reindex All** (specifically for the Objects engine).

## 6. Troubleshooting

- **Port Conflicts**: Ensure ports 3001 (Microservice) and 5173 (Frontend) are available.
- **SQLite Latency**: On some systems, first-run database initialization may take a few seconds.
- **Mocking**: If tests fail due to network errors, ensure MSW is correctly initialized in `setupTests.js`.

---

_For architectural details, refer to the [System Map](./SYSTEM_MAP.md)._
