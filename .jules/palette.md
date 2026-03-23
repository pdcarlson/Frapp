## 2024-10-24 - Accessible Icon-Only Buttons
**Learning:** Icon-only buttons with `aria-label`s are not always accessible to sighted users relying on pointers. Visual tooltips are required.
**Action:** Always pair `aria-label` with a native HTML `title` attribute or a robust Tooltip component (like Radix `Tooltip`) for icon-only buttons to ensure visual tooltips appear on hover for sighted mouse/pointer users, improving discoverability without altering layout dimensions.
