# Specification index

**`spec/`** is the normative source for product behavior, architecture, environments, UI expectations, security notes, and focused test specifications. Developer workflows and runbooks live under **`docs/`**—start at [`docs/README.md`](../docs/README.md) and [`docs/guides/README.md`](../docs/guides/README.md).

## Core

| Document                                       | Purpose                               |
| ---------------------------------------------- | ------------------------------------- |
| [`product/`](product/README.md)                | Features, flows, surfaces             |
| [`behavior/`](behavior/README.md)              | Rules, edge cases, invariants         |
| [`architecture.md`](architecture.md)           | Stack, data model, auth, API patterns |
| [`architecture-chunks/`](architecture-chunks/) | Architecture-level chunk briefs       |
| [`environments.md`](environments.md)           | Local, staging, production; CI/CD     |

## UI

| Document                                       | Purpose                     |
| ---------------------------------------------- | --------------------------- |
| [`ui-brand-identity.md`](ui-brand-identity.md) | Brand and identity          |
| [`ui-landing.md`](ui-landing.md)               | Marketing site              |
| [`ui-web-dashboard.md`](ui-web-dashboard.md)   | Admin web app (nav, screens; maps to RBAC including chapter-wide `GET /v1/polls` / Points audit list) |
| [`ui-assets.md`](ui-assets.md)                 | Assets and sync             |
| [`ui-resilience.md`](ui-resilience.md)         | Resilience and empty states |

## Security

| Document                                                           | Purpose            |
| ------------------------------------------------------------------ | ------------------ |
| [`security-path-traversal.md`](security-path-traversal.md)         | Path traversal     |
| [`security-content-validation.md`](security-content-validation.md) | Content validation |

## Test specs (`spec/tests/`)

Implementation-focused test and coverage notes. **Convention:** every file uses the **`*.spec.md`** suffix. Browse [`tests/`](tests/).

Conventions for documentation updates: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../docs/internal/DOCUMENTATION_CONVENTIONS.md).

---

## Roadmap

The chat-first redesign is one **project** in Frapp's in-repo project board. It is delivered as numbered chunks; each chunk's full brief is co-located with the topic it primarily affects under [`behavior/<topic>/chunks/`](behavior/) or [`architecture-chunks/`](architecture-chunks/). Architectural context (product positioning, hot-path architecture, theming model, engineering principles) lives in [`redesign-context.md`](redesign-context.md).

**Status lives on the board, not here.** Chunk status, the issue list, and progress are tracked in [`docs/internal/board/chat-redesign.md`](../docs/internal/board/chat-redesign.md) — the source of truth (run `/status` for a live dashboard). This section is just the index of chunk **briefs** (the normative specs); the briefs themselves stay in `spec/`.

| #   | Title                                              | Brief                                                                                            |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 01  | Foundation: design bundle + theme + shell          | [`behavior/branding/chunks/01-foundation.md`](behavior/branding/chunks/01-foundation.md)         |
| 02  | Data model + chapter directory + Edge Function     | [`architecture-chunks/02-data-edge.md`](architecture-chunks/02-data-edge.md)                     |
| 03  | Onboarding wizard + chapter directory UX           | [`behavior/onboarding/chunks/03-onboarding.md`](behavior/onboarding/chunks/03-onboarding.md)     |
| 04  | Chat foundation + hot-path client                  | [`behavior/chat/chunks/04-chat-foundation.md`](behavior/chat/chunks/04-chat-foundation.md)       |
| 05  | Chat integrations + slash commands + push          | [`behavior/chat/chunks/05-chat-integrations.md`](behavior/chat/chunks/05-chat-integrations.md)   |
| 06  | Settings shell + Org + Modules tabs                | [`behavior/settings/chunks/06-settings-shell.md`](behavior/settings/chunks/06-settings-shell.md) |
| 07  | Settings customization (theme, roles, fields, dues) | [`behavior/settings/chunks/07-settings-custom.md`](behavior/settings/chunks/07-settings-custom.md) |
| 08  | Settings Beta + Audit + ops-setup nudges           | [`behavior/settings/chunks/08-settings-beta-audit.md`](behavior/settings/chunks/08-settings-beta-audit.md) |
| 09  | Members directory + custom fields rendering        | [`behavior/members/chunks/09-members.md`](behavior/members/chunks/09-members.md)                 |
| 10  | Ops integrations (10a–10h)                         | [`behavior/integrations/chunks/10-ops-integrations.md`](behavior/integrations/chunks/10-ops-integrations.md) |
| 11  | Mobile chat parity                                 | [`behavior/chat/chunks/11-mobile-chat.md`](behavior/chat/chunks/11-mobile-chat.md)               |
| 12  | Marketing site refresh                             | [`product/chunks/12-marketing.md`](product/chunks/12-marketing.md)                               |

Roadmap process conventions (branch model, doc-sync mandate, review checklist) live at [`docs/internal/redesign/README.md`](../docs/internal/redesign/README.md).
