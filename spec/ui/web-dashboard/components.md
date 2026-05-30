# Web Dashboard — Component Library

> The ShadCN install set and the custom components built on top of it. Foundation tokens are in [layout.md](layout.md); per-screen usage is in [screens.md](screens.md).

The dashboard uses **ShadCN UI** as the component library (installed into `apps/web` via the CLI, customized to match the bone / bronze / ink palette — see [brand-identity.md](../brand-identity.md)).

---

## ShadCN components to install

```text
button, input, select, textarea, label, card, dialog, sheet,
dropdown-menu, command, popover, toast, badge, avatar, separator,
table, tabs, tooltip, skeleton, switch, checkbox, radio-group,
calendar, date-picker, accordion, alert, progress, scroll-area
```

---

## Custom components

| Component | Purpose |
| --------- | ------- |
| `ChapterLockup` | Sidebar chapter crest + name + designation/school (see [README.md](README.md#sidebar)) |
| `BetaBadge` | BETA indicator in one of four styles, sourced from `chapters.beta_config` |
| `StatCard` | Stat display (icon + number + label + trend) |
| `MemberRow` | Table row with avatar, name, role badge, points |
| `ActivityItem` | Feed item (icon + text + timestamp) |
| `PermissionCheckbox` | Permission name + description + toggle |
| `RoleBadge` | Colored badge matching the role color |
| `StatusBadge` | Status indicator (active / paid / overdue / absent) |
| `FileDropzone` | Drag-and-drop file upload area |
| `EmptyState` | Illustrated empty state with an action button |
| `LoadingSkeleton` | Shimmer placeholder matching each page layout |
| `ErrorBoundary` / `ErrorState` | Graceful error display with a retry button |
| `OfflineBanner` | Network-status banner (see [state.md](state.md)) |

---

## Conventions

- **Semantic interactives only.** Rows and controls that change client state are `<button type="button">`; rows that navigate use the framework's `Link`. No `<div onClick>` for interactive affordances. Soft-disabled / "Soon" items use `aria-disabled="true"` + `tabIndex={-1}`; hard-disabled items use the native `disabled` attribute.
- **Empty / loading / error states are first-class.** Every list, channel, search, and panel renders an explicit empty, loading, and error state rather than a blank surface — see [state.md](state.md).
- **Motif utilities.** Dashboard surfaces reach for the `.eyebrow` and `.ledger-line` utility classes from `globals.css` rather than re-implementing the micro-label + ledger-line motifs per page. Monospace surfaces (`#chapter-audit` cards, eyebrow ledger labels) render against the system-monospace `--font-mono` stack — no webfont is bundled.
- **Chat renderers** live in `components/chat/renderers/` and dispatch on `message.kind`; unknown kinds fall back to the text renderer (see [screens.md](screens.md#chat-chat)).
