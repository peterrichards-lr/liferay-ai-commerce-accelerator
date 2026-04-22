# Workflow: Liferay AI Commerce Accelerator

## Development Lifecycle
1. **Research**: Analyze Liferay API schemas and existing code patterns.
2. **Strategy**: Formulate a plan for changes, considering dependencies and state management.
3. **Implementation**: Atomic, surgical updates to services and generators.
4. **Validation**: Test against mocked APIs and, if possible, a live Liferay instance.

## Workflow Orchestration
- Asynchronous batch submissions with unique ERCs for correlation.
- Multi-step sequences (e.g., Create Parent -> Fetch ID -> Create Child).
- WebSocket-based progress updates for real-time UI feedback.
- Exception handling with `errorRef` for traceability.

## Deployment
- Build as Client Extensions using Gradle.
- Configured via `client-extension.yaml` in each component.
