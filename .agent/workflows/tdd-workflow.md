---
description: Feature Development (SDD + TDD)
---

# Workflow

## Phase 1: Specification (The "Think" Phase)

1.  **Analyze Request:** detailed understanding of the user's goal.
2.  **Draft Spec:** Create `specs/FEATURE_NAME.md` using the `.agent/templates/spec.md` template.
3.  **Review:** Ask the user to review and approve the Spec. **DO NOT PROCEED WITHOUT APPROVAL.**

## Phase 2: The "Red" State (Test)

1.  **Scaffold Test:** Create the test file (e.g., `apps/api/src/domain/feature/feature.spec.ts`).
2.  **Write Assertions:** Implement the test cases defined in the Spec.
3.  **Verify Failure:** Ensure the test fails because the implementation doesn't exist yet.

## Phase 3: The "Green" State (Implementation)

1.  **Scaffold Code:** Create the controller/service files.
2.  **Implement Logic:** Write the code to satisfy the test.
3.  **Verify Success:** Run the test to confirm it passes.

## Phase 4: Verification & Cleanup

1.  **Integration Check:** Does this break anything else?
2.  **Documentation:** Update Swagger/OpenAPI annotations.
3.  **Commit:** Suggest a conventional commit message.
