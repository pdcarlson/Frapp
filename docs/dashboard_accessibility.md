# Dashboard Accessibility Guidelines

This document serves as a ledger of specific accessibility fixes and guidelines enforced on the dashboard components to ensure comprehensive accessibility compliance.

## Search Inputs (Search Bars)
All icon-only search boxes without a visible `<label>` element must be accompanied by an `aria-label` attribute conveying the field's explicit context and searchable entity types.

**Examples:**
- **Members**: `aria-label="Search members by name"`
- **Events**: `aria-label="Search events by name or location"`
- **Points (Leaderboard)**: `aria-label="Search leaderboard by user ID"`
- **Points (Transactions)**: `aria-label="Search transactions by description"`
- **Billing**: `aria-label="Search invoices or members"`
