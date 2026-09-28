/**
 * The statuses in which a Discord import may be cleared off the chapter's
 * list: only a deleted one (#2817).
 *
 * The list is the only place that offers "Delete import", and nothing brings a
 * cleared import back, so clearing one that still holds what it brought in
 * would leave that history with no way to remove it. The admin deletes first,
 * then clears the record that is left.
 *
 * Shared because the API refuses the clear and the web decides whether to
 * offer it: two copies of the rule could drift into a button the API refuses.
 */
export const DISCORD_IMPORT_CLEARABLE_STATUSES = ["purged"] as const;

export function isDiscordImportClearable(status: string): boolean {
  return (DISCORD_IMPORT_CLEARABLE_STATUSES as readonly string[]).includes(
    status,
  );
}
