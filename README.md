# Liferay AI Commerce Accelerator

Gradle builds the fragment which wraps the custom element and provides configuration options via the Page Builder AI.

## Frontend (Dev)

```bash
(cd ./client-extensions/ai-commerce-accelerator-frontend && npm run dev)
```

## Microservice (Local)

```bash
(rm -f client-extensions/ai-commerce-accelerator-microservice/logs/*.log || true) && blade gw :client-extensions:ai-commerce-accelerator-microservice:clean :client-extensions:ai-commerce-accelerator-microservice:deploy :client-extensions:ai-commerce-accelerator-microservice:packageRunDebug
```