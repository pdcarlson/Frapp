# Security notes

Security guidance and history for operators/agents. (Canonical product security rules live in the
relevant `spec/behavior/` files; these are implementation/ops notes.)

| Doc | Scope |
| --- | ----- |
| [`authorization-model.md`](authorization-model.md) | Route → guard → ownership-proof map, and the RLS truth table (which layer enforces tenancy per table); regression-covered by `apps/api/test/cross-tenant-isolation.e2e-spec.ts` |
| [`ai-prompt-injection.md`](ai-prompt-injection.md) | Prompt-injection threat model for the AI corpus + acting agent; enforced by `apps/api/test/ai-evals/` |
| [`content-validation.md`](content-validation.md) | File-upload content-type/extension allowlists, size caps, and filename stripping in storage paths; SVG-XSS warning |
| [`security-fixes.md`](security-fixes.md) | Historical log of applied security fixes |
| [`../internal/ci-cd/SECRET_SCANNING.md`](../internal/ci-cd/SECRET_SCANNING.md) | gitleaks secret-scanning gate (pre-commit + CI; ADR-13/ADR-17 push-protection replacement) |
