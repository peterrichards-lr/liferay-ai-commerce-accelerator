# Tech Stack: Liferay AI Commerce Accelerator

## Microservice
- **Runtime**: Node.js (v22+)
- **Framework**: Express.js
- **Database**: SQLite (via `better-sqlite3`)
- **API Communication**: Axios (REST), GraphQL
- **AI Integration**: OpenAI SDK
- **WebSocket**: `ws` library

## Frontend UI
- **Framework**: React
- **Build Tool**: Vite
- **Styling**: Vanilla CSS (based on Liferay Lexicon/Clay)

## Liferay Integration
- **Framework**: Client Extensions (CX)
- **APIs**: Headless REST, Headless Batch Engine, GraphQL

## Testing (Proposed)
- **Unit/Integration**: Vitest
- **API Mocking**: Mock Service Worker (MSW)
- **E2E**: Playwright or Cypress
