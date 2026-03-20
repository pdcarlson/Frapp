# Financial Invoice Controller Tests

This document describes the test suite for `FinancialInvoiceController`.

## Tested Functionalities
- `list`: Verifies listing invoices by user ID or chapter.
- `listOverdue`: Verifies retrieving overdue invoices.
- `getOne`: Verifies getting an invoice by ID.
- `create`: Verifies creating a member invoice.
- `update`: Verifies updating a draft invoice.
- `transitionStatus`: Verifies transitioning the status of an invoice.
- `getInvoiceTransactions`: Verifies getting transactions for an invoice.

## Access Control Checks
Tests ensure the appropriate permissions metadata is set for route handlers.
- `SystemPermissions.BILLING_VIEW` is required for `listOverdue` and `getInvoiceTransactions`.
- `SystemPermissions.BILLING_MANAGE` is required for `create`, `update`, and `transitionStatus`.
