import { SetMetadata } from '@nestjs/common';

export const REQUIRED_MODULE_KEY = 'required_module';

/**
 * Ties a controller (or a single route) to a `chapters.enabled_modules` key
 * from the `@repo/org-archetypes` `MODULE_CATALOG`.
 *
 * `ChapterGuard` reads this metadata and rejects **writes** to the route when
 * the chapter has explicitly disabled that module. Reads are always allowed:
 * `spec/product/modules.md` guarantees "Data is preserved — re-enabling
 * restores access", so a disabled module hides and freezes a surface, it does
 * not strand the chapter's existing data behind the toggle.
 *
 * Only paid, toggleable modules belong here. Free always-on modules (chat,
 * members, announcements, audit-log, chapter-settings) cannot be turned off,
 * so gating them would be dead code.
 *
 * Applied at class level for whole-module controllers; a handler-level
 * decorator overrides the class (`Reflector.getAllAndOverride`).
 */
export const RequireModule = (moduleKey: string) =>
  SetMetadata(REQUIRED_MODULE_KEY, moduleKey);
