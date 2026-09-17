import type { ChapterAuditLogService } from '../../src/application/services/chapter-audit-log.service';

/**
 * The one `ChapterAuditLogService` double (#2167).
 *
 * `record` is the single writer to `chapter_audit_log`, so every service spec
 * that exercises an audited mutation binds a stub of it. Seven specs did that
 * in four different spellings, one of which returned bare `undefined` rather
 * than a promise — harmless while every caller `await`s, and a per-spec
 * surprise the day one does not. One home, so the shape cannot drift per spec.
 *
 * `Pick<…, 'record'>` rather than a hand-written signature: a change to
 * `RecordAuditEntryInput` reaches every spec by reference instead of by
 * someone remembering.
 */
export type AuditLogServiceMock = jest.Mocked<
  Pick<ChapterAuditLogService, 'record'>
>;

/**
 * A fresh stub whose `record` resolves, matching the real method's contract.
 *
 * A spec binding this asserts *what its service asks for*. The row `record`
 * then writes — `scope`, `member_visible`, the `target_id` / `diff` defaults,
 * and the log-then-rethrow on a failed write — is asserted once, in
 * `chapter-audit-log.service.spec.ts`, which is the point of there being one
 * writer. Two things that does **not** cover, and a caller's own spec must:
 * an argument the caller passes explicitly where it used to take the default
 * (`memberVisible` is the live case), and the from/to envelope the settings
 * family puts in `diff` (`AuditDiff`).
 */
export function createAuditLogServiceMock(): AuditLogServiceMock {
  return { record: jest.fn().mockResolvedValue(undefined) };
}
