# Chapter Settings

Spec content for the settings surface (org config, theming, roles, custom fields, workflows, dues) is delivered via the chat-rework chunks. Stable rules will land here as each chunk ships.

## Chunks (co-located briefs)

- [`chunks/06-settings-shell.md`](chunks/06-settings-shell.md) — settings shell + Org + Modules tabs.
- [`chunks/07-settings-custom.md`](chunks/07-settings-custom.md) — theme + roles + custom fields + workflows + dues.
- [`chunks/08-settings-beta-audit.md`](chunks/08-settings-beta-audit.md) — beta + audit + ops-setup nudges.

Until those chunks ship, the related rules currently live in:

- [`../chapter-config.md`](../chapter-config.md) — `GET/PATCH /chapters/:id/config` endpoints (Chunk 02).
- [`../rbac.md`](../rbac.md) — role lifecycle and permission catalog.
- [`../branding/README.md`](../branding/README.md) — chapter branding, logo, accent color.
- [`../billing.md`](../billing.md) — dues invoicing.
