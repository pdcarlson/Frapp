import { ForbiddenException } from '@nestjs/common';
import { isModuleEnabled, moduleDisabledMessage } from '@repo/validation';

/** The chapter's `enabled_modules` as `ChapterGuard` read it for this request. */
export type EnabledModules = Record<string, boolean> | null;

/**
 * Refuses a write to a module the chapter has switched off, with the one
 * refusal every module gate returns (`spec/product/modules.md` § Module
 * disabling behavior).
 *
 * `ChapterGuard` calls it for routes that carry `@RequireModule`. A write that
 * shares a route with an always-on module can't be gated by route metadata,
 * so its service calls this directly: a `kind: "poll"` chat message and a vote
 * on a poll card go through chat routes, not `poll.controller.ts` (#2993).
 *
 * Enabled unless explicitly `false` (the shared `isModuleEnabled`), so a
 * chapter with no key for a module is never locked out of it.
 */
export function assertModuleEnabled(
  enabledModules: EnabledModules,
  moduleKey: string,
): void {
  if (isModuleEnabled(enabledModules, moduleKey)) return;
  throw new ForbiddenException({
    code: 'chapter.module.disabled',
    // Built by `@repo/validation` because the clients recognise this refusal
    // by its message (#2995 moves them to the code first), and only the
    // message names the module. Installed builds match it exactly, so it
    // can't be reworded.
    message: moduleDisabledMessage(moduleKey),
  });
}
