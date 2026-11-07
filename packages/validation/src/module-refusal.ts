const MODULE_DISABLED_PREFIX = 'The "';
const MODULE_DISABLED_SUFFIX =
  '" module is disabled for this chapter. Re-enable it in Settings → Modules to make changes.';

/**
 * The message `ChapterGuard.enforceModule` refuses a write with when `key` is
 * off. The guard throws exactly this string, so it lives here rather than in
 * the guard: the clients recognise the refusal by it, and one builder means
 * the two cannot drift.
 *
 * It is addressed to an officer ("Re-enable it in Settings → Modules"), which
 * is right for the web dashboard and wrong for a member, who cannot follow it.
 * A member surface matches it with `moduleRefusalFromServerMessage` and shows
 * its own copy instead.
 */
export function moduleDisabledMessage(key: string): string {
  return `${MODULE_DISABLED_PREFIX}${key}${MODULE_DISABLED_SUFFIX}`;
}

/**
 * Recognise the module gate's refusal from the server's `message`, returning
 * the module it names, or `null` for any other message.
 *
 * **Why the message.** The guard also throws `code: 'chapter.module.disabled'`,
 * but until #1020 `AllExceptionsFilter` dropped it, so a branch keyed on the
 * code typechecked, passed any test that hand-built a body with `code`, and
 * never fired in production: that was mobile study's module branch until
 * #2393. The code reaches clients now, but only this message names the
 * module, and installed builds match it; checking the code first is #2995.
 * Nor is a bare 403 a substitute, because the same routes 403 for permission
 * denials that must keep their own copy.
 *
 * The match is exact apart from the key: the whole fixed prefix and suffix
 * must be present, and the key between them must be non-empty and unquoted.
 */
export function moduleRefusalFromServerMessage(
  message: string | null | undefined,
): { moduleKey: string } | null {
  if (typeof message !== "string") return null;
  if (!message.startsWith(MODULE_DISABLED_PREFIX)) return null;
  if (!message.endsWith(MODULE_DISABLED_SUFFIX)) return null;
  const moduleKey = message.slice(
    MODULE_DISABLED_PREFIX.length,
    message.length - MODULE_DISABLED_SUFFIX.length,
  );
  if (moduleKey.length === 0 || moduleKey.includes('"')) return null;
  return { moduleKey };
}
