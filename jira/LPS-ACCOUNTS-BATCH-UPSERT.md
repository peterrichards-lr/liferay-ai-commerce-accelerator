# Liferay DXP JIRA Feature Request / Bug: Headless Admin User Accounts Batch Endpoint Lacks Upsert / Update Support

## Component

- **Headless Admin User / Accounts**
- **Vulcan Batch Engine**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts` (and all earlier versions featuring the Headless Admin User APIs).
- **API Endpoint**: `/o/headless-admin-user/v1.0/accounts/batch`

## Summary

Unlike other Liferay headless batch APIs (such as Headless Commerce Catalog's Products batch and Pricing's Price Entries batch), the `/o/headless-admin-user/v1.0/accounts/batch` endpoint only supports creating new accounts. It does not support updating existing accounts (upsert behavior) when matching by `externalReferenceCode` (ERC). If any account in the batch payload already exists in the DXP instance, the entire batch task fails with duplicate record errors, rather than updating the existing record. This inconsistency forces client extensions and integration frameworks to implement complex, sequential teardown/delete steps instead of employing clean, idempotent batch updates.

## Description & Technical Analysis

Standard vulcan-based batch endpoints support idempotent data synchronizations where:

1. If a record with a given `externalReferenceCode` does not exist, it is created.
2. If a record with a given `externalReferenceCode` does exist, it is updated.

However, the Accounts Batch resource implementation (class: `com.liferay.headless.admin.user.internal.jaxrs.v1_0.AccountBatchResourceImpl`) delegates imports to the Vulcan Batch Engine under a pure `CREATE` execution context.

When the Batch Engine attempts to import an account whose `externalReferenceCode` matches an existing entry, the database constraint check fails at the persistence layer, raising a duplicate entity exception. Because there is no handler or alternative routing to run an update on existing ERCs, the batch task marks the items as failed and aborts.

## Steps to Reproduce

### 1. Submit an initial batch to create an account

```bash
curl -X 'POST' \
  'https://localhost:8080/o/headless-admin-user/v1.0/accounts/batch' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -u 'test@liferay.com:test' \
  -d '[
    {
      "externalReferenceCode": "AICA-ACC-TEST-001",
      "name": "Initial Test Account"
    }
  ]'
```

This batch will succeed and create the account.

### 2. Submit the same payload again, changing only the account name

```bash
curl -X 'POST' \
  'https://localhost:8080/o/headless-admin-user/v1.0/accounts/batch' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -u 'test@liferay.com:test' \
  -d '[
    {
      "externalReferenceCode": "AICA-ACC-TEST-001",
      "name": "Updated Test Account"
    }
  ]'
```

### 3. Observe the Batch Engine Task Status

Check the status of the resulting import task.

## Expected Results

The batch engine updates the account with `externalReferenceCode` equal to `AICA-ACC-TEST-001`, renaming it to `"Updated Test Account"`, and completes successfully.

## Actual Results / Logs

The background batch task fails with a duplicate entity exception:

```text
com.liferay.portal.kernel.exception.DuplicateAccountException: Account with externalReferenceCode AICA-ACC-TEST-001 already exists
```

## Workaround & Resolution

To work around this, client integrations must query all accounts manually, find the matching items by ERC, extract their internal IDs, and then either:

1. Delete all existing accounts before running the batch import (non-idempotent teardown).
2. Perform individual HTTP `PUT` updates for each existing account and only use the batch endpoint for brand new items.

### Proposed Fix

Align the Headless Admin User accounts batch API behavior with standard Headless Commerce APIs, allowing the underlying batch delegate to check for existing `externalReferenceCode` matches and route to updates (upserts) automatically.
