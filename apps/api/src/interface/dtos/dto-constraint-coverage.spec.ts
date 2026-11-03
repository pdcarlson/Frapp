import 'reflect-metadata';
import { getMetadataStorage, validate, ValidationTypes } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { INT4_MAX } from '#domain/constants/field-limits';
import { loadDtoClasses, type DtoClass } from '#test/helpers/dto-corpus';

/**
 * Criterion 1 of #849 asked for "a DTO audit table (or lint rule) showing every
 * property constrained". This is the lint rule: a table would be accurate the
 * day it was written and wrong by the next PR, whereas this fails in CI the
 * moment coverage regresses.
 *
 * What it actually guards: the global pipe runs `whitelist: true`, so a
 * property carrying *no* decorators is stripped before it reaches a service —
 * harmless. The dangerous shape is a property that carries only a **gate**
 * (`@IsOptional`, `@ValidateIf`, `@Allow`): the gate is enough to survive
 * whitelisting, but nothing then checks the value. `SendMessageDto.metadata`
 * was exactly that, and it reached a DB write untyped.
 *
 * So the invariant is narrow and precise: any property the pipe will let
 * through must have at least one real constraint behind the gate.
 */

/** Decorators that only decide *whether* to validate, never *what* is valid. */
const GATE_ONLY: readonly string[] = [
  ValidationTypes.CONDITIONAL_VALIDATION, // @IsOptional, @ValidateIf
  ValidationTypes.WHITELIST, // @Allow
];

/**
 * Property -> the validators registered on it, for one class.
 *
 * class-validator files every standard decorator under the `customValidation`
 * *type* and keeps the decorator's identity in `name` (`min`, `isUuid`, …), so
 * both fields matter: `type` distinguishes a gate from a constraint, `name`
 * says which constraint it is.
 */
interface RegisteredValidator {
  type: string;
  name: string;
  constraints: unknown[];
}

function constraintsByProperty(
  cls: DtoClass,
): Map<string, RegisteredValidator[]> {
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(
    cls,
    '',
    false,
    false,
  );
  const byProp = new Map<string, RegisteredValidator[]>();
  for (const m of metadatas) {
    if (!m.propertyName) continue;
    const found = byProp.get(m.propertyName) ?? [];
    found.push({
      type: m.type,
      name: (m as { name?: string }).name ?? m.type,
      constraints: m.constraints ?? [],
    });
    byProp.set(m.propertyName, found);
  }
  return byProp;
}

describe('DTO constraint coverage (#849)', () => {
  const classes = loadDtoClasses();

  it('finds the DTO classes to audit', () => {
    // A refactor that moves or renames the DTO directory would otherwise make
    // this suite vacuously pass with nothing to check. The floor sits just
    // under the real count (94 at the time of writing) rather than at a token
    // value, so losing a chunk of the directory fails here instead of silently
    // shrinking what the next test audits.
    expect(classes.length).toBeGreaterThan(80);
  });

  it('no property survives whitelisting with only a gate decorator', () => {
    const offenders: string[] = [];

    for (const cls of classes) {
      for (const [prop, found] of constraintsByProperty(cls)) {
        const hasRealConstraint = found.some(
          (v) => !GATE_ONLY.includes(v.type),
        );
        if (!hasRealConstraint) {
          const only = found.map((v) => `@${v.name}`).join(', ');
          offenders.push(`${cls.name}.${prop} (only: ${only})`);
        }
      }
    }

    // Named in the failure so the fix is obvious without re-running a scan.
    expect(offenders).toEqual([]);
  });

  /**
   * `@IsInt()` properties with no `@Max`, each with why it needs none (#3045).
   * Every other integer field must carry one: past `INT4_MAX` an `int` column
   * answers Postgres `22003`, which the client gets as a 500, sometimes after
   * part of the write committed. A new field lands here only with a reason.
   */
  const UNBOUNDED_INTS: Record<string, string> = {
    'RequestBackworkUploadUrlDto.size_bytes':
      'not stored; the service refuses one past MAX_UPLOAD_BYTES with its own message',
    'RequestDocumentUploadUrlDto.size_bytes':
      'not stored; the service refuses one past MAX_UPLOAD_BYTES with its own message',
    'RequestChatUploadUrlDto.size_bytes':
      'not stored; the service refuses one past MAX_UPLOAD_BYTES with its own message',
    'RequestProofUploadUrlDto.size_bytes':
      'not stored; the service refuses one past MAX_UPLOAD_BYTES with its own message',
    'RequestAvatarUploadUrlDto.size_bytes':
      'not stored; the service refuses one past MAX_UPLOAD_BYTES with its own message',
    'DiscordImportUploadFileDto.byte_size':
      'bigint column; the service refuses one past MAX_ARCHIVE_UPLOAD_BYTES',
    'ConfirmDocumentUploadDto.byte_size': 'bigint column',
    'MessageAttachmentDto.byte_size': 'bigint column',
    'ListChapterAuditLogQueryDto.limit': 'a page size, clamped to 1–200',
    'ListPointTransactionsQueryDto.limit': 'a page size, clamped to 1–200',
    'ListPollsQueryDto.limit': 'a page size, clamped to 1–200',
    'CustomFieldOptionsDto.max_length':
      'a jsonb key; only the web form reads it',
  };

  it('every integer field has a ceiling, or a reason it needs none', () => {
    const offenders: string[] = [];
    const reasoned = new Set<string>();

    for (const cls of classes) {
      for (const [prop, found] of constraintsByProperty(cls)) {
        if (!found.some((v) => v.name === 'isInt')) continue;
        const key = `${cls.name}.${prop}`;
        const max = found.find((v) => v.name === 'max');
        if (max) {
          // A ceiling above int4 lets 2147483648 through to the same 22003.
          const ceiling = Number(max.constraints[0]);
          if (!(ceiling <= INT4_MAX)) offenders.push(`${key} (max ${ceiling})`);
        } else if (key in UNBOUNDED_INTS) reasoned.add(key);
        else offenders.push(key);
      }
    }

    expect(offenders).toEqual([]);
    // A reason whose field gained a bound, or no longer exists, is stale.
    expect(Object.keys(UNBOUNDED_INTS).filter((k) => !reasoned.has(k))).toEqual(
      [],
    );
  });

  // [class, property, what makes the value hostile, the value]. The reason
  // comes third because jest fills `%s` positionally — with the value there,
  // four cases were named after 101 literal `x` characters and no case could
  // be selected with `-t`.
  it.each([
    ['AdjustPointsDto', 'amount', 'award above the ceiling', 2_147_483_647],
    ['AdjustPointsDto', 'amount', 'fine below the floor', -2_147_483_648],
    ['AdjustPointsDto', 'target_user_id', 'non-uuid target', 'not-a-uuid'],
    ['AdjustPointsDto', 'reason', 'unbounded reason', 'x'.repeat(501)],
    ['CreateFinancialInvoiceDto', 'amount', 'unpayable amount', 100_000_000],
    ['UpdateFinancialInvoiceDto', 'amount', 'unpayable amount', 100_000_000],
    ['CreateFinancialInvoiceDto', 'title', 'oversized title', 'x'.repeat(256)],
    [
      'ListPointTransactionsQueryDto',
      'user_id',
      'non-uuid filter',
      'not-a-uuid',
    ],
    [
      'TransferPresidencyDto',
      'target_member_id',
      'non-uuid target',
      'not-a-uuid',
    ],
    ['SendMessageDto', 'metadata', 'untyped blob', 'a string, not an object'],
    ['CreateRoleDto', 'name', 'oversized role name', 'x'.repeat(101)],
    ['CreateRoleDto', 'name', 'empty role name', ''],
    ['UpdateRoleDto', 'name', 'oversized role name', 'x'.repeat(101)],
    ['CreateCustomRoleDto', 'label', 'oversized role label', 'x'.repeat(101)],
    ['UpdateCustomRoleDto', 'label', 'oversized role label', 'x'.repeat(101)],
    ['CreateCustomRoleDto', 'key', 'oversized role key', 'x'.repeat(65)],
    // Every path that writes point_transactions.amount, not just the manual one.
    ['CreateEventDto', 'point_value', 'ledger write above the ceiling', 2e9],
    ['UpdateEventDto', 'point_value', 'ledger write above the ceiling', 2e9],
    ['CreateTaskDto', 'point_reward', 'ledger write above the ceiling', 2e9],
    ['ListPollsQueryDto', 'channel_id', 'non-uuid channel', 'not-a-uuid'],
    [
      'ListChapterAuditLogQueryDto',
      'actor_user_id',
      'non-uuid filter',
      'not-a-uuid',
    ],
    [
      'ListChapterAuditLogQueryDto',
      'action',
      'unbounded action filter',
      'x'.repeat(65),
    ],
    ['StartStudySessionDto', 'geofence_id', 'non-uuid geofence', 'not-a-uuid'],
    // The study rate is a ledger input too; the computed total is #948.
    ['CreateGeofenceDto', 'points_per_interval', 'unbounded award rate', 2e9],
    ['UpdateGeofenceDto', 'points_per_interval', 'unbounded award rate', 2e9],
    ['CreateServiceEntryDto', 'duration_minutes', 'unbounded award input', 2e9],
    // Each of these reached an int4 column, so 3e9 was a Postgres 500 (#3045).
    ['ConfirmBackworkUploadDto', 'year', 'int4 overflow', 3_000_000_000],
    [
      'ConfirmBackworkUploadDto',
      'assignment_number',
      'int4 overflow',
      3_000_000_000,
    ],
    ['BrandingDto', 'founded_at', 'int4 overflow', 3_000_000_000],
    ['WorkflowConfigDto', 'threshold', 'int4 overflow', 3_000_000_000],
    ['DuesConfigDto', 'active_amount_cents', 'int4 overflow', 3_000_000_000],
    [
      'DuesConfigDto',
      'new_member_amount_cents',
      'int4 overflow',
      3_000_000_000,
    ],
    ['DuesConfigDto', 'alumni_amount_cents', 'int4 overflow', 3_000_000_000],
    ['DuesConfigDto', 'installment_count', 'int4 overflow', 3_000_000_000],
    ['DuesConfigDto', 'late_fee_cents', 'int4 overflow', 3_000_000_000],
    ['DuesConfigDto', 'grace_days', 'int4 overflow', 3_000_000_000],
    ['DuesConfigDto', 'scholarship_pool_cents', 'int4 overflow', 3_000_000_000],
    ['ServiceConfigDto', 'minutes_per_point', 'int4 overflow', 3_000_000_000],
    ['CreateDocumentFolderDto', 'sort_order', 'int4 overflow', 3_000_000_000],
    ['UpdateDocumentFolderDto', 'sort_order', 'int4 overflow', 3_000_000_000],
    ['CreateCategoryDto', 'display_order', 'int4 overflow', 3_000_000_000],
    ['UpdateCategoryDto', 'display_order', 'int4 overflow', 3_000_000_000],
    ['CreateCustomFieldDto', 'sort', 'int4 overflow', 3_000_000_000],
    ['UpdateCustomFieldDto', 'sort', 'int4 overflow', 3_000_000_000],
    ['CreateCustomRoleDto', 'rank', 'int4 overflow', 3_000_000_000],
    ['UpdateCustomRoleDto', 'rank', 'int4 overflow', 3_000_000_000],
    [
      'DiscordImportUploadFileDto',
      'part_index',
      'int4 overflow',
      3_000_000_000,
    ],
    [
      'DiscordChannelMappingDto',
      'message_count',
      'int4 overflow',
      3_000_000_000,
    ],
    ['CreateRoleDto', 'display_order', 'int4 overflow', 3_000_000_000],
    ['UpdateRoleDto', 'display_order', 'int4 overflow', 3_000_000_000],
    ['CreateGeofenceDto', 'minutes_per_point', 'int4 overflow', 3_000_000_000],
    [
      'CreateGeofenceDto',
      'min_session_minutes',
      'int4 overflow',
      3_000_000_000,
    ],
    [
      'CreateGeofenceDto',
      'pause_grace_minutes',
      'int4 overflow',
      3_000_000_000,
    ],
    ['UpdateGeofenceDto', 'minutes_per_point', 'int4 overflow', 3_000_000_000],
    [
      'UpdateGeofenceDto',
      'min_session_minutes',
      'int4 overflow',
      3_000_000_000,
    ],
    [
      'UpdateGeofenceDto',
      'pause_grace_minutes',
      'int4 overflow',
      3_000_000_000,
    ],
    ['VoteDto', 'option_indexes', 'option past the last', [10]],
    // A position stored at INT4_MAX would make the next `max + 1` overflow.
    [
      'CreateCustomFieldDto',
      'sort',
      'position at the int4 edge',
      2_147_483_647,
    ],
  ])('%s.%s rejects an %s', async (className, prop, _why, hostileValue) => {
    // Asserted by *validating a value*, not by naming decorators: composing
    // these bounds into a custom decorator later is a refactor, and a test
    // that failed on that would be measuring the implementation rather than
    // the rule. These are the properties #849 called out as server-decided,
    // money-shaped, or unbounded.
    //
    // `validate` runs with NO whitelist options on purpose. Under
    // `forbidNonWhitelisted` an *undeclared* property yields an error whose
    // `.property` is that same name ("property X should not exist"), so this
    // assertion passed whether the bound existed or not — deleting a decorator,
    // or typo-ing a row, left the whole table green. Without the option a
    // property with no constraints produces no error at all, and the row fails.
    const cls = classes.find((c) => c.name === className);
    expect(cls).toBeDefined();

    const errors = await validate(
      plainToInstance(cls as DtoClass, { [prop]: hostileValue }),
    );

    expect(errors.map((e) => e.property)).toContain(prop);
  });
});
