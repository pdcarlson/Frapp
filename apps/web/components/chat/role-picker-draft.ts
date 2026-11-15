/**
 * The Role picker form's draft, apart from the form itself, so the chat shell
 * can hold it without pulling the form into the first download
 * (`deferred-panels.tsx`, #3716).
 */

/** What the + card keeps while the Role picker form is closed (#3983). */
export interface RolePickerDraft {
  title: string;
  /** In the order the officer ticked them, which is the card's order. */
  roleIds: string[];
}

export function emptyRolePickerDraft(): RolePickerDraft {
  return { title: "", roleIds: [] };
}
