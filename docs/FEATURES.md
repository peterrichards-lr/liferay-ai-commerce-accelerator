# Features & Capabilities

The Liferay AI Commerce Accelerator provides a comprehensive suite of tools for data generation and management.

## AI Data Generation

Rapidly create high-quality commerce entities using state-of-the-art generative AI.

### Supported Entities

- **Products**: Generates localized names, descriptions, and specifications.
- **Accounts**: Creates realistic business accounts with multiple addresses (Billing, Shipping, Head Office). Choose Business, Individual, or Mixed — and with Mixed, set the business/individual split explicitly rather than leaving the proportion to the model.
- **Orders**: Generates historical order data linked to products and accounts.
- **Warehouses**: Creates inventory locations and manages stock distribution.

### Chunked Generation

Large requests are split across multiple AI calls rather than asking for everything at once, which is what stops responses being truncated mid-schema when generating hundreds of entities.

- **Products, Accounts, Orders, Warehouses** split the requested **count**: ask for 200 products at a chunk size of 10 and the service makes 20 calls and concatenates the results.
- **Pricing** splits the **input list** instead, because it is driven by how many products it has been given rather than by a requested total. Its `priceListName` belongs to the list as a whole, so the first one is kept when the chunks are merged.
- Chunk sizes are configurable per entity in the **AI Chunk Sizes** panel of the Configuration client extension, clamped to 1–50 with a default of 10.

Promotions are deliberately **not** chunked: they generate user segments alongside promotions from the whole catalogue, and splitting the input would fragment those segments across calls.

### Visual Assets & Media

- **AI Images**: Generates product visuals using DALL-E or Nano Banana.
- **AI PDFs**: Creates detailed documentation like User Guides, Technical Specs, or Compliance sheets.
- **Placeholder Mode**: Use lightweight mock assets for rapid prototyping without AI costs.

## Real-time Monitoring

The **Dashboard** provides granular feedback on every generation session.

- **Overall Progress Gauge**: A striking visual summary of the entire workflow.
- **System Health Strip**: Real-time status of Liferay connectivity, WebSockets, and AI providers.
- **Activity Log**: Detailed audit trail of all microservice operations.
- **Unified Consoles**: The Live Console and the Seeder Console are the same component, so both offer level filtering, real-time search, auto-scroll, clear, and copy-to-clipboard of whatever the filters currently show — useful for pasting a failure into an issue.
- **Batch Error Tracking**: Specialized view for diagnosing failures at the External Reference Code (ERC) level.

## Dynamic Configuration

Everything is manageable via the **AI Commerce Accelerator Configuration** UI.

- **Provider Agnosticism**: Switch between OpenAI and Google Gemini for text generation (Anthropic support is scaffolded but not yet implemented — see [#482](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/482)).
- **Dedicated Media Keys**: Configure separate credentials for image generation (e.g., Nano Banana).
- **Custom Prompts & Schemas**: Tailor the AI's output by editing the templates directly in the browser with a built-in CodeMirror editor.
- **Exclude Lists**: Protect system data by specifying items that should never be modified or deleted.

## System Administration & Troubleshooting

A dedicated **Admin Dashboard** provides high-level oversight and diagnostic tools for platform operators.

### Session Management

- **Session Explorer**: View a complete history of all generation and deletion runs.
- **Advanced Filtering**: Filter by session name, date range, or outcome (Success, Failed, Cancelled).
- **History Sorting**: Sort sessions to quickly find the latest runs or analyze past failures.
- **Targeted Export**: Retrieve the exact AI-generated dataset from any previous successful run.
- **Failure Diagnostics**: Immediate visibility into why a session failed, including the specific workflow step.

### KPI Metrics

- **Success vs. Failure Rate**: Real-time tracking of generation reliability.
- **Session Volume**: Monitor total usage and throughput of the accelerator.

### Configuration Doctor

- **Automated Diagnostics**: Real-time alerts for missing AI API keys, invalid prompts, or broken Liferay connectivity.
- **Direct Resolution Links**: Deep-links to the exact configuration screen in DXP required to fix an issue.
- **System Parity**: Ensure environment consistency by identifying drifted settings across Liferay instances.

## Data Portability

- **Export**: Save your generated data set to a JSON file for backup or sharing.
- **Import**: Restore a previously generated data set into a new environment.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-04_ | _Last Reviewed: 2026-09-04_
