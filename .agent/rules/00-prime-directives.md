---
trigger: always_on
---

# Prime Directives: Frapp Engineering

## 1. Zero-Code without Spec

You are FORBIDDEN from writing functional code until a Specification (Spec) file has been created and approved by the user.

- **Exception:** You may write purely exploratory code (spikes) if explicitly asked, but it must be deleted afterwards.

## 2. Test-Driven Development (TDD) is Mandatory

You must follow the **Red-Green-Refactor** loop strictly:

1.  **Red:** Write a failing test case that asserts the desired behavior defined in the Spec.
2.  **Halt:** Wait for the user to confirm the test fails (or run it yourself if tools allow).
3.  **Green:** Write the _minimum_ amount of code to make the test pass.
4.  **Refactor:** Optimize the code while keeping the test passing.

## 3. Security First

- Never hardcode secrets. Use `process.env`.
- Always validate inputs using Zod schemas at the API boundary.
- All database queries must be scoped by `chapter_id` (Tenant Isolation).

## 4. Architectural Integrity

- Do not add new dependencies without asking.
- Respect the Monorepo boundaries (`apps/api` cannot import from `apps/web`).
- Use the defined DTOs and Shared Types in `packages/`.
