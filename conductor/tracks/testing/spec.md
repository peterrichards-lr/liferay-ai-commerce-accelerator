# Track Specification: Microservice - Testing & Mocking

## Objective

Implement comprehensive unit and integration tests for the microservice, leveraging Liferay API mocking.

## Requirements

- Comprehensive MSW handlers for all Liferay APIs used by the microservice (Products, Accounts, Orders, Pricing, etc.).
- Handlers should be based on `api-schemas/` but include documented "real-world" Liferay behaviors.
- Unit tests for all major services: `LiferayService`, `PersistenceService`, `AIService`.
- Integration tests for `AccountGenerator`, `ProductGenerator`.

## Success Criteria

- Test coverage for all discovery methods in `LiferayService`.
- Generators are tested for success and failure paths.
- Mocking accurately reflects Liferay's async batch engine behavior (callbacks).

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
