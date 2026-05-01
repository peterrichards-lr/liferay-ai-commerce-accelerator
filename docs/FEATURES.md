# Features & Capabilities

The Liferay AI Commerce Accelerator provides a comprehensive suite of tools for data generation and management.

## AI Data Generation

Rapidly create high-quality commerce entities using state-of-the-art generative AI.

### Supported Entities

- **Products**: Generates localized names, descriptions, and specifications.
- **Accounts**: Creates realistic business accounts with multiple addresses (Billing, Shipping, Head Office).
- **Orders**: Generates historical order data linked to products and accounts.
- **Warehouses**: Creates inventory locations and manages stock distribution.

### Visual Assets & Media

- **AI Images**: Generates product visuals using DALL-E or Nano Banana.
- **AI PDFs**: Creates detailed documentation like User Guides, Technical Specs, or Compliance sheets.
- **Placeholder Mode**: Use lightweight mock assets for rapid prototyping without AI costs.

## Real-time Monitoring

The **Dashboard** provides granular feedback on every generation session.

- **Overall Progress Gauge**: A striking visual summary of the entire workflow.
- **System Health Strip**: Real-time status of Liferay connectivity, WebSockets, and AI providers.
- **Activity Log**: Detailed audit trail of all microservice operations.
- **Batch Error Tracking**: Specialized view for diagnosing failures at the External Reference Code (ERC) level.

## Dynamic Configuration

Everything is manageable via the **AI Commerce Accelerator Configuration** UI.

- **Provider Agnosticism**: Switch between OpenAI, Google Gemini, and Anthropic for text generation.
- **Dedicated Media Keys**: Configure separate credentials for image generation (e.g., Nano Banana).
- **Custom Prompts & Schemas**: Tailor the AI's output by editing the templates directly in the browser with a built-in CodeMirror editor.
- **Exclude Lists**: Protect system data by specifying items that should never be modified or deleted.

## Data Portability

- **Export**: Save your generated data set to a JSON file for backup or sharing.
- **Import**: Restore a previously generated data set into a new environment.
