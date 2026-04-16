# Frapp Bugbot Rules

- Treat `docs/` and `spec/` as part of the source of truth. Flag any non-doc code, CI, tooling, or config change that does not update related documentation or spec files in the same PR.
- Protect the branch model: feature work targets `main`, and promotion PRs target `production` from `main` only.
- Be strict about deploy safety: if workflow names, required checks, or promotion gates change, the matching runbooks and branch-protection automation must change in the same PR.
- Flag any suggestion that would weaken secret handling, authentication, authorization, or migration safety.
