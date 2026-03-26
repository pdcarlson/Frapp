## 2024-05-24 - Accessibility for Icon-only Input fields
**Learning:** In UI components like search `<Input>` fields that lack a visible text `<label>` and rely only on a placeholder and an icon, it's critical to always add a descriptive `aria-label` to the input element to ensure accessibility for screen reader users.
**Action:** When adding or modifying `<Input>` fields without a visible `<label>`, make sure to add an `aria-label` prop.
