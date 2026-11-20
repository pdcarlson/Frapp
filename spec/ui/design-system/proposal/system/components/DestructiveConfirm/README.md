The one question asked before something is deleted or removed.

**Status:** Confirmed on web (rulebook § 4: a destructive step uses `useConfirmDialog`). Proposed on the phone, which uses the system alert.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/confirm-dialog.tsx` | `useConfirmDialog` |
| Phone | `apps/mobile/lib/chat/confirm-destructive.ts` (a helper over the system alert) | `confirmDestructive` |

## Anatomy

A centred dialog (see Panel and sheet): `popover`, `radius-2xl`, 24 of padding.

- **Title:** the question, naming the thing in quotes. `Delete "Book the banquet hall deposit"?`
- **One line** under it, in 14 `muted-foreground`: a fact about what goes with it. Not "This can't be undone" unless that is the only fact.
- **Buttons** at the trailing edge: Cancel (Secondary), then the verb and the noun on a Destructive button ("Delete task"). The Destructive button is `destructive-tint` with `destructive-text` at 700: a tint, never a solid red.
- **Type to confirm** for what can't be undone at scale (removing a member, deleting a chapter): a field that asks for the thing's name, and the button stays disabled until it matches.
- An optional comment field when the person affected will be told why.

## You provide

`title`, `description`, `confirmLabel`, and optionally `typeToConfirm` or `comment`.

## Rules

- Only for destroying something. Leaving a form never asks: the draft is kept.
- The destructive action lives in the more menu, last, after a break. Never in a record's body or footer, and never offered against yourself.
- The button says what it does. Never "OK", "Yes" or "Confirm".
- No browser `confirm`, `alert` or `prompt` (lint).
- Focus returns to what opened it.

## Web and phone

The system keeps web's dialog and proposes the same surface on the phone, with the warning haptic, so the last step before a delete looks like Frapp on both. Until it is built, every phone confirm goes through the one helper, so the surface can change in one place. The system alert stays for what the OS itself asks (permissions).

## Drift

Phone: 21 alerts carry a destructive button in 20 files, and only 4 go through `confirmDestructive`; 19 files write the alert by hand. Web: `useConfirmDialog` has 40 call sites; W18 finds 13 red buttons sitting in a record's body or footer and 7 delete or revoke hooks with no confirm in the same file.
