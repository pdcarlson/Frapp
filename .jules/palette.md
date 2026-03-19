
## 2024-03-20 - Search Inputs Missing ARIA Labels
**Learning:** Icon-only or placeholder-only search `<Input>` components commonly miss `aria-label` attributes if they aren't explicitly wrapped in a `<label>`. This makes them invisible/inaccessible to screen readers on various dashboard route tables (e.g., Events, Points).
**Action:** When adding or reviewing filter/search input boxes inside table headers or dashboards, verify they always include a descriptive `aria-label` like "Search events by name or location" if no visible label element is bound to them.
