
## 2025-03-20 - Global Error UX
**Learning:** Plain, unstyled buttons in generic error boundaries (like `global-error.tsx`) create a jarring fallback experience that lacks focus states and breaks consistency.
**Action:** Always verify error boundaries use design system components like `Button` to ensure keyboard accessibility and consistent styling, even during catastrophic failures.
