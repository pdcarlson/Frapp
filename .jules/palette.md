## 2024-03-20 - Adding Accessibility Attributes to Command Menu Triggers
**Learning:** Command menu triggers often rely on visual cues (like "⌘K") to indicate their functionality. Without an explicit `aria-label`, screen readers may simply read the button text "Search (⌘K)" which can be confusing or lack full context, particularly if the user relies on a keyboard.
**Action:** When adding command menu triggers or other shortcut-bound buttons, ensure they have a descriptive `aria-label` that clarifies the action and spells out the keyboard shortcut in a readable format for AT users (e.g., "Command K").

## 2024-03-28 - Adding Accessibility Attributes to Icon-only Search Inputs
**Learning:** Some custom components, like `Input` components used for search fields that omit a standard `<label>` and instead rely heavily on a placeholder attribute and a generic preceding decorative `Search` icon for context, lack meaningful names for screen reader users. Screen readers might fail to announce the specific purpose of the input ("Search events" vs "Search members") if they only read "Edit text" or the placeholder.
**Action:** When creating or modifying search inputs that lack a visible `<label>`, explicitly include a descriptive `aria-label` attribute (e.g. `aria-label="Search events by name or location"`) to ensure assistive technology clearly announces the input's purpose and scope.
