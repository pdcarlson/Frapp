# User-visible changes (maintenance log)

Brief notes for behavior that members or admins will notice. For full product rules see [`spec/behavior.md`](../../spec/behavior.md).

## Unreleased

- **Web — recurring events:** Editing or deleting a repeating chapter event can apply to **this occurrence only**, **this and future**, or the **entire series**, so changes no longer appear to “snap back” when viewing other weeks. Deletes that remove the series drop child occurrences before the parent row so the database stays consistent.
