# Skill: Verification (TDD)

When the user asks to "Implement Feature X", you MUST follow this sequence:

1. **Check for Spec:**
   - Look for `specs/feature-x.md`.
   - If missing, STOP. Ask the user to help draft it.

2. **Run the Red Test:**
   - Command: `pnpm test -- filter=feature-x`
   - Expectation: FAILURE.
   - If it passes, the test is broken.

3. **Implement & Green:**
   - Write the code.
   - Run: `pnpm test -- filter=feature-x`
   - Expectation: SUCCESS.

4. **Security Scan:**
   - Check: Did I verify `x-chapter-id`?
   - Check: Did I use Zod validation?
