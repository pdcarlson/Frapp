// @ts-check
import nestjsTyped from '@darraghor/eslint-plugin-nestjs-typed';
import eslint from '@eslint/js';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Pattern bans, one rule name each. Every rule below is the core
// `no-restricted-syntax` under another name. Flat config gives each file
// the *last* matching block's options for a rule, so two blocks that both
// configured `no-restricted-syntax` with different `files` would silently
// drop one ban wherever they overlap. A name per ban keeps each one's scope
// and exemptions its own, and the name in the lint output says which
// invariant broke.
const restrictedSyntax = builtinRules.get('no-restricted-syntax');
const frapp = {
  rules: {
    'chapter-audit-log-one-writer': restrictedSyntax,
    'no-throwable-logger-extra': restrictedSyntax,
    'no-hand-rolled-error-coercion': restrictedSyntax,
    'no-logger-warn-stack': restrictedSyntax,
  },
};

/** `logger.<level>(…)` / `this.logger.<level>(…)`, any receiver ending in `logger`. */
const loggerCall = (levels) =>
  `CallExpression[callee.type='MemberExpression'][callee.property.name=/^(${levels})$/]:matches([callee.object.name=/logger$/], [callee.object.property.name=/logger$/])`;

/** A catch binding, a settled reason, or any `…Error` name: a throwable. */
const THROWABLE_NAME = '/^(err|error|e|reason|[A-Za-z][A-Za-z0-9]*Error)$/';

/**
 * A second argument the logger prints as text rather than inspects: a string,
 * a template, a context object, JSON, or an Error's `.stack`.
 */
const NOT_RENDERED =
  ":not(MemberExpression[property.name='stack'], ObjectExpression, TemplateLiteral, Literal, CallExpression[callee.object.name='JSON'])";

/** A coercion's false branch that is anything but a constant string. */
const NON_CONSTANT_ALTERNATE =
  ":not([alternate.type='Literal'], [alternate.type='TemplateLiteral'][alternate.expressions.length=0])";

const THROWABLE_EXTRA_MESSAGE =
  "Don't pass a throwable as Logger.error/warn's extra argument: Nest's ConsoleLogger util.inspects it, which prints a PostgREST error's `details` (row values) into plaintext logs (#1669). Use logThrowable() from infrastructure/observability/log-throwable.";

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  // Response-schema rule: every controller method must declare the response type
  // it returns. This is what makes the generated SDK usable — a route with no
  // declared response generates `content?: never`, so callers get no types for
  // the body and the contract silently says "returns nothing".
  //
  // ROLLOUT: deliberately "warn", not "error", and it must stay that way until
  // the route-DTO backfill lands. The rule fires once per undecorated controller
  // method, and there are far more of them than the planning docs' ~30 guess —
  // that estimate was out by roughly 5x, and is exactly the number someone
  // would use to decide the backlog was finished. Count them before trusting
  // any figure: `npm run lint:api 2>&1 | grep -c api-method-should-specify`.
  // A number written here would go stale and be believed. ESLint has no native
  // baseline mechanism the way dependency-cruiser does, so "error" today would
  // simply turn `lint`, a required check, red on every PR until every one of
  // those routes is done. Warn now, backfill, then flip to "error" and delete
  // this paragraph.
  //
  // Only the plugin's `nestjs-typed/api-method-should-specify-api-response` rule
  // is enabled. The bundled `flatRecommended` preset turns on 20+ rules at once,
  // which is a different and much larger decision.
  {
    files: ['src/**/*.controller.ts'],
    plugins: { 'nestjs-typed': nestjsTyped.plugin },
    rules: {
      'nestjs-typed/api-method-should-specify-api-response': 'warn',
    },
  },
  {
    plugins: { frapp },
  },
  // One writer for `chapter_audit_log` (#2167). `ChapterAuditLogService.record`
  // owns the row shape and the log-then-rethrow that fails a request whose
  // audit failed; services inject it rather than inserting inline. The two
  // exempt files are its repository and the compile-only insert-type check,
  // which performs no runtime write. Adding a file here is not the fix for a
  // new inline writer. Not seen: a table name reached through a variable, or
  // a name built by concatenation or interpolation, or a raw-SQL insert
  // through an RPC.
  {
    files: ['src/**/*.ts'],
    ignores: [
      '**/*.spec.ts',
      'src/infrastructure/supabase/database.types.insert-check.ts',
      'src/infrastructure/supabase/repositories/supabase-chapter-audit-log.repository.ts',
    ],
    rules: {
      'frapp/chapter-audit-log-one-writer': [
        'error',
        ...[
          "CallExpression[callee.property.name='from'][arguments.0.value='chapter_audit_log']",
          "CallExpression[callee.property.name='from'][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.cooked='chapter_audit_log']",
        ].map((selector) => ({
          selector,
          message:
            'chapter_audit_log has one writer (#2167): inject ChapterAuditLogService and call record(), which owns scope, member_visible, the target_id/diff defaults and the rethrow that fails the request.',
        })),
      ],
    },
  },
  // How a caught throwable reaches a log line (#1669, #2114, #2460). Each
  // selector set is wider than the source scan it replaced, never narrower:
  // that scan matched argument text, so a selector here matches the shape
  // anywhere inside the second argument rather than only at its top.
  // `eslint-bans.spec.ts` lints every shape the scan pinned and fails if one
  // stops being reported.
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'frapp/no-throwable-logger-extra': [
        'error',
        ...[
          `${loggerCall('error|warn')} > Identifier.arguments:nth-child(2)[name=${THROWABLE_NAME}]`,
          // An allSettled reason, bare, optional-chained, or as a fallback
          // (`c ? 'x' : r.reason`, `r.reason.stack ?? r.reason`). Not when it
          // is only the object of a further read, as in `r.reason.message`.
          `${loggerCall('error|warn')} > MemberExpression.arguments:nth-child(2)[property.name='reason']`,
          `${loggerCall('error|warn')} > ${NOT_RENDERED}.arguments:nth-child(2) MemberExpression[property.name='reason']:not(.object)`,
          // `as Error` in any type: `Error & { code?: string }` is the usual
          // way to type-lie a PostgREST error into a logger.
          `${loggerCall('error|warn')} > TSAsExpression.arguments:nth-child(2) TSTypeReference[typeName.name='Error']`,
          `${loggerCall('error|warn')} > ${NOT_RENDERED}.arguments:nth-child(2) TSAsExpression TSTypeReference[typeName.name='Error']`,
          // `error instanceof Error ? error.stack : error` (#2114): the false
          // branch is the object itself. `: String(error)` is not this leak.
          `${loggerCall('error|warn')} > ConditionalExpression.arguments:nth-child(2) Identifier.alternate[name=/^(err|error|e|reason)$/]`,
        ].map((selector) => ({ selector, message: THROWABLE_EXTRA_MESSAGE })),
      ],
      'frapp/no-logger-warn-stack': [
        'error',
        ...[
          `${loggerCall('warn')} > MemberExpression.arguments:nth-child(2)[property.name='stack']`,
          `${loggerCall('warn')} > *.arguments:nth-child(2) MemberExpression[property.name='stack']`,
        ].map((selector) => ({
          selector,
          message:
            "Don't hand logger.warn a stack: ConsoleLogger.warn takes no stack parameter and prints its second argument as the context (#2460). Use logThrowable().",
        })),
      ],
    },
  },
  // `src/domain/` is exempt: it may not import observability
  // (`api-domain-is-innermost`), and its one coercion formats JSON.parse's
  // SyntaxError, which is always an Error. The selector can't check that both
  // branches name the same value, so it flags any `instanceof Error` ternary
  // whose true branch reads `.stack` or `.message` and whose false branch is
  // anything but a constant string.
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts', 'src/domain/**'],
    rules: {
      'frapp/no-hand-rolled-error-coercion': [
        'error',
        ...[
          `ConditionalExpression[test.operator='instanceof'][test.right.name='Error'][consequent.property.name=/^(stack|message)$/]${NON_CONSTANT_ALTERNATE}`,
          `ConditionalExpression[test.operator='instanceof'][test.right.name='Error'][consequent.operator='??'][consequent.left.property.name=/^(stack|message)$/]${NON_CONSTANT_ALTERNATE}`,
        ].map((selector) => ({
          selector,
          message:
            "Don't hand-roll `x instanceof Error ? x.stack : String(x)` (#2460): a non-Error throwable (a raw PostgREST record, a Realtime err, an allSettled reason) renders as `[object Object]`. Use logThrowable() for a log line and toReportableError(x).message for any other string.",
        })),
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-empty': 'off',
    },
  },
);
