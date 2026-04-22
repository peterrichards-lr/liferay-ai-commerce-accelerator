# Product Definition: Liferay AI Commerce Accelerator

## Vision
To provide a reference implementation for accelerating Liferay Commerce adoption using AI-driven data generation and automated workflows.

## Key Features
- AI-driven generation of Commerce entities (Products, Accounts, Orders, Warehouses).
- Asynchronous batch processing with progress monitoring.
- Real-time feedback via WebSockets.
- Resilient deletion workflows with dependency handling.
- Demo/Live mode toggle for flexible deployment.

## Components
- **Microservice**: The central orchestrator, handling AI interactions and Liferay API calls.
- **Frontend UI**: User interface for triggering and monitoring workflows.
- **Configuration UI**: Administrative interface for managing accelerator settings.
- **Batch CX**: Defines the structure of data sent to Liferay.
