# Form submission resilience

> Part of [Network resilience](README.md).

## Preventing Double Submission

Every form submission button:
1. Disables on click
2. Shows loading spinner
3. Re-enables on success or failure
4. Uses a mutation lock (TanStack Query's `isPending` state)

```tsx
<Button disabled={mutation.isPending} onClick={handleSubmit}>
  {mutation.isPending ? <Spinner /> : 'Save'}
</Button>
```

## Preserving Unsaved Work

For long forms (event creation, invoice creation, settings):
1. Auto-save draft to `sessionStorage` every 5 seconds while the form is dirty
2. On page load, check for a saved draft and offer to restore: "You have unsaved changes. [Restore] [Discard]"
3. Clear the draft on successful submission

## Handling Concurrent Edits

When two admins edit the same resource simultaneously:
1. The API returns the updated resource with its `updated_at` timestamp
2. If the client's known `updated_at` is older than the server's, show: "This resource was modified by another user. [Refresh] [Overwrite]"
3. For v1: last-write-wins is acceptable for most resources. Chat messages are append-only so this doesn't apply.

---
