# AICA Model Context Protocol (MCP) Server

The Liferay AI Commerce Accelerator (AICA) includes a built-in **Model Context Protocol (MCP)** server exposed inside the microservice.

AI agents (such as Gemini, Claude, Cursor, or Antigravity) can connect to this server over **Server-Sent Events (SSE)** to inspect, monitor, generate, and clean up commerce datasets programmatically.

---

## Architecture Overview

Because the microservice runs as a long-lived Express HTTP daemon, the MCP server is exposed using the **SSE Transport** layer. This prevents stdout/stderr pollution and enables remote or containerized agents to interact with the AICA stack over standard HTTP/HTTPS ports.

```text
+-------------------+                      +-----------------------------------+
|                   |   GET /mcp/sse       |                                   |
|   AI Agent        |--------------------->|   AICA Microservice               |
|   (MCP Client)    |<---------------------|   (SSE MCP Server)                |
|                   |   SSE Stream         |                                   |
+-------------------+                      |   Port: 3001                      |
        |                                  |   Base Route: /api/v1/mcp         |
        |   POST /mcp/message              |                                   |
        +--------------------------------->|                                   |
            JSON-RPC Request               +-----------------------------------+
```

---

## Connection Endpoints

The base URL for MCP endpoints under the microservice is `/api/v1/mcp`.

1. **Establish SSE Stream** (`GET /api/v1/mcp/sse`):
   Initiates the persistent SSE connection from the client. The server responds with a `connect` event containing the endpoint target for future client messages.
2. **Post JSON-RPC Messages** (`POST /api/v1/mcp/message`):
   Accepts standard JSON-RPC 2.0 frames representing tool list queries and tool executions.

---

## Available MCP Tools

Once connected, AICA registers the following tools for the agent:

| Tool Name                 | Parameters                                                                                                                | Description                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `aica_get_status`         | None                                                                                                                      | Returns connectivity diagnostics, DXP health, database stats, and loaded configurations.        |
| `aica_list_sessions`      | None                                                                                                                      | Lists past data generation/import session details.                                              |
| `aica_get_session_logs`   | `sessionId` (string, required)                                                                                            | Extracts the execution logs and stack traces from the active logs for a specific session ID.    |
| `aica_trigger_generation` | `productCount` (int), `accountCount` (int), `orderCount` (int), `generatePriceLists` (bool), `generateSkuVariants` (bool) | Triggers a background AI commerce generation run.                                               |
| `aica_delete_session`     | `sessionId` (string, required)                                                                                            | Performs targeted teardown of DXP objects and local database entries for a specific session ID. |
| `aica_teardown_all`       | None                                                                                                                      | Wipes all generated AICA commerce data from the DXP instance and resets the database.           |

---

## Client Integration Examples

### 1. Claude Desktop Integration

To register AICA inside Claude Desktop, add the following to your `claude_desktop_config.json` configuration file:

```json
{
  "mcpServers": {
    "aica": {
      "command": "node",
      "args": [
        "-e",
        "const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js'); const { Client } = require('@modelcontextprotocol/sdk/client/index.js'); const transport = new SSEClientTransport(new URL('http://localhost:3001/api/v1/mcp/sse')); const client = new Client({ name: 'claude-client', version: '1.0' }); client.connect(transport).then(() => console.log('Connected to AICA MCP Server!'));"
      ]
    }
  }
}
```

### 2. Standalone Node.js SSE Client

You can run a standalone client script using the `@modelcontextprotocol/sdk` package:

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport(
  new URL('http://localhost:3001/api/v1/mcp/sse')
);

const client = new Client({
  name: 'aica-diagnostic-client',
  version: '1.0.0',
});

await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools);

// Call a tool
const status = await client.callTool({
  name: 'aica_get_status',
  arguments: {},
});
console.log('AICA status:', status.content[0].text);
```

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
