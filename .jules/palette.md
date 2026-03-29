## 2024-03-20 - Adding Accessibility Attributes to Command Menu Triggers
**Learning:** Command menu triggers often rely on visual cues (like "⌘K") to indicate their functionality. Without an explicit `aria-label`, screen readers may simply read the button text "Search (⌘K)" which can be confusing or lack full context, particularly if the user relies on a keyboard.
**Action:** When adding command menu triggers or other shortcut-bound buttons, ensure they have a descriptive `aria-label` that clarifies the action and spells out the keyboard shortcut in a readable format for AT users (e.g., "Command K").
## 2023-10-24 - Accessibility aria-labels on Input fields
**Learning:** In this application, `<Input>` fields used for search functionality often rely solely on placeholder text or surrounding icons for visual context, lacking explicit `<label>` elements.
**Action:** When working on `<Input>` or `<Search>` components that don't have a linked `<label>`, always add a descriptive `aria-label` to ensure screen reader compatibility.
