# Liferay DXP Bug Report: Account Group Association Endpoint Parameter Swapping

LPD-DRAFT - (Not yet submitted to Liferay JIRA)

## Component

- **Headless Admin User**
- **Account Groups / User Segments API**

## Environment

- **Liferay Product Version**: Liferay DXP 2026.q1 or 7.4 U80+
- **API Endpoint**: `POST /o/headless-admin-user/v1.0/account-groups/by-external-reference-code/{accountExternalReferenceCode}/accounts/by-external-reference-code/{externalReferenceCode}`

## Summary

The REST endpoint used to assign an account to an account group via external reference codes (ERCs) has its path parameters swapped in Liferay's internal JAX-RS Java backend implementation. The first path parameter (which visually represents the account group's ERC in the URL path) is mapped to the account's ERC, and the second path parameter (which visually represents the account's ERC in the URL path) is mapped to the account group's ERC.

Consequently:

- Submitting a standard request matching the URL template (Group ERC first, Account ERC second) fails with `404 Not Found`.
- Submitting a swapped request (Account ERC first, Group ERC second) succeeds with `204 No Content`.

## Description & Technical Analysis

The OpenAPI specification defines the path as:
`"/v1.0/account-groups/by-external-reference-code/{accountExternalReferenceCode}/accounts/by-external-reference-code/{externalReferenceCode}"`

And the parameters as:

1. `accountExternalReferenceCode` (representing the placeholder after `account-groups/by-external-reference-code/`)
2. `externalReferenceCode` (representing the placeholder after `accounts/by-external-reference-code/`)

In Liferay's JAX-RS resource implementation class, the Java method signature is annotated as follows:

```java
@POST
@Path("/account-groups/by-external-reference-code/{accountExternalReferenceCode}/accounts/by-external-reference-code/{externalReferenceCode}")
public Response postAccountGroupByExternalReferenceCodeAccountByExternalReferenceCode(
    @PathParam("accountExternalReferenceCode") String accountExternalReferenceCode,
    @PathParam("externalReferenceCode") String externalReferenceCode) {
    ...
}
```

Confused by the name `accountExternalReferenceCode` (which is used for the Account Group's ERC because of an upstream copy-paste error from another endpoint), the internal Java service implementation swaps the arguments:

- It looks up the `AccountEntry` using the first parameter (`accountExternalReferenceCode`).
- It looks up the `AccountGroup` using the second parameter (`externalReferenceCode`).

If the request is sent with the placeholders in their correct positions (e.g. `/account-groups/by-external-reference-code/GROUP-ERC/accounts/by-external-reference-code/ACCOUNT-ERC`), Liferay tries to query the database/index for an `AccountEntry` with ERC `GROUP-ERC` and an `AccountGroup` with ERC `ACCOUNT-ERC`. Since neither exists in those tables, it returns a silent `404 Not Found`.

## Steps to Reproduce

1. Create an Account Group with `externalReferenceCode = SEG-TEST-GROUP`.
2. Create a Business Account with `externalReferenceCode = ACC-TEST-ACCOUNT`.
3. Try to associate them by invoking the REST API in standard order:

   ```bash
   curl -i -u test@liferay.com:test -X POST http://localhost:8080/o/headless-admin-user/v1.0/account-groups/by-external-reference-code/SEG-TEST-GROUP/accounts/by-external-reference-code/ACC-TEST-ACCOUNT
   ```

4. Note that Liferay returns `404 Not Found`:

   ```json
   {
     "status": "NOT_FOUND"
   }
   ```

5. Invoke the REST API with the swapped path parameter values:

   ```bash
   curl -i -u test@liferay.com:test -X POST http://localhost:8080/o/headless-admin-user/v1.0/account-groups/by-external-reference-code/ACC-TEST-ACCOUNT/accounts/by-external-reference-code/SEG-TEST-GROUP
   ```

6. Note that Liferay returns `204 No Content` (Success) and the association is successfully saved in the `accountgrouprel` table.

## Expected Results

The REST endpoint should correctly map parameters to their matching path templates:

- The first placeholder `/account-groups/by-external-reference-code/{accountGroupERC}` should map to the Account Group.
- The second placeholder `/accounts/by-external-reference-code/{accountERC}` should map to the Account.

## Workaround

In our client extension SDK, we swap the variables when constructing the URL:

```javascript
  async assignAccountToGroup(config, groupERC, accountERC) {
    // WORKAROUND: Liferay's REST endpoint internally swaps the parameters:
    // the first placeholder maps to account ERC, and the second maps to group ERC.
    return await this._post(
      config,
      `/o/headless-admin-user/v1.0/account-groups/by-external-reference-code/${encodeURIComponent(accountERC)}/accounts/by-external-reference-code/${encodeURIComponent(groupERC)}`,
      null,
      'assign-account-to-group',
      'Failed to assign account to group'
    );
  }
```

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
