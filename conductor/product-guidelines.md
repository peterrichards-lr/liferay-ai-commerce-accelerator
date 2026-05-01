# Product Guidelines: Liferay AI Commerce Accelerator

## Architecture

- **Stateless Callbacks**: Always use unique correlation keys (like `batchERC`) in callback URLs.
- **Race-Safe Persistence**: Persist state _before_ external side effects.
- **Hybrid Storage**: Use `PersistenceService` (SQLite) for critical workflow state and `CacheService` (Memory) for transient data.

## Coding Standards

- **Self-Documenting Code**: No comments; use clear naming and structure.
- **Modular Steps**: Keep generator steps isolated and reusable.

## API Usage

- **Validation**: All API calls must be validated against `api-schemas/`.
- **GraphQL Preference**: Prefer GraphQL for data retrieval; REST for mutations/batch.
- **Resilience**: Implement retries with exponential backoff for search indexing lag.
