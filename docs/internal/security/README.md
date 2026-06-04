# Security notes

Security guidance and history for operators/agents. (Canonical product security rules live in the
relevant `spec/behavior/` files; these are implementation/ops notes.)

| Doc | Scope |
| --- | ----- |
| [`content-validation.md`](content-validation.md) | File-upload content-type/extension allowlists; SVG-XSS warning |
| [`path-traversal.md`](path-traversal.md) | `path.basename()` on uploaded filenames across upload endpoints |
| [`SECURITY_FIXES.md`](SECURITY_FIXES.md) | Historical log of applied security fixes |
| [`../ci-cd/SECRET_SCANNING.md`](../ci-cd/SECRET_SCANNING.md) | gitleaks secret-scanning gate (pre-commit + CI; ADR-13/ADR-17 push-protection replacement) |
