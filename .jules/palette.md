## 2025-03-20 - Icon Button Tooltips
**Learning:** Icon-only buttons with `aria-label` attributes provide accessibility for screen readers but offer no visual indication of their purpose to sighted mouse/pointer users, leading to discoverability issues.
**Action:** Always pair `aria-label` with a native `title` attribute (or a robust Tooltip component) on icon-only buttons to ensure both groups of users receive proper context.
