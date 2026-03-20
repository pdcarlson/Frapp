
## 2025-03-20 - Global Error UX
**Learning:** Plain, unstyled buttons in generic error boundaries (like `global-error.tsx`) create a jarring fallback experience that lacks focus states and breaks consistency.
**Action:** Always verify error boundaries use design system components like `Button` to ensure keyboard accessibility and consistent styling, even during catastrophic failures.

## 2025-03-20 - Keyboard Shortcut Visibility
**Learning:** Inline text like `(⌘K)` for shortcuts inside buttons lacks visual hierarchy and can be misread.
**Action:** Wrap keyboard shortcuts in a styled `<kbd>` element to clearly separate action text from keyboard hints.
