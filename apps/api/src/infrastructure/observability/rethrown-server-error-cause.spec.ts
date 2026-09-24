import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import * as ts from 'typescript';
import {
  REPOSITORY_SRC_ROOT as SRC_ROOT,
  collectApiSources,
} from '#test/helpers/repository-corpus';

/**
 * A 5xx thrown from a `catch` keeps what it caught (#2131).
 *
 * `AllExceptionsFilter` reports every status >= 500 to Sentry, and what it
 * reports is the exception it was handed. A catch that logs the provider
 * error and then throws a fresh `ServiceUnavailableException('…temporarily
 * unavailable')` hands it a constant: a bad Stripe price, a revoked key, an
 * outage and a timeout all become one Sentry issue whose stack ends at the
 * rethrow (FRAPP-API-4). The fix is `{ cause: toReportableError(error) }`,
 * which Sentry's `LinkedErrors` follows and `beforeSend` scrubs value by
 * value, while the HTTP body never carries it (`sentry-integration.spec.ts`,
 * `all-exceptions.filter.sentry.spec.ts`).
 *
 * Seven sites had lost the cause before this lock existed, so the rule is
 * enforced here rather than trusted to review. In a `catch` clause, and in a
 * handler passed to `.catch(…)` or as `.then`'s second argument, `throw new`
 * one of the 5xx exceptions below (or `HttpException` with a 5xx status) must
 * pass an object literal whose `cause` is `toReportableError(…)`. The call is
 * required, not merely the key: a plain PostgREST object as `cause` is
 * something `LinkedErrors` silently skips.
 *
 * Not judged, and stated so nobody reads more into a green run: a throw built
 * by a helper (`throw this.unavailable(error)`), and a throw in a function
 * merely *declared* inside a catch, which runs later and elsewhere.
 */
const SERVER_ERROR_EXCEPTIONS = new Set([
  'BadGatewayException',
  'GatewayTimeoutException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
]);

/** `HttpStatus` members at or above 500, for `new HttpException(msg, status)`. */
const SERVER_ERROR_STATUSES = new Set([
  'INTERNAL_SERVER_ERROR',
  'NOT_IMPLEMENTED',
  'BAD_GATEWAY',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'HTTP_VERSION_NOT_SUPPORTED',
]);

interface RethrowSite {
  line: number;
  exception: string;
  hasCause: boolean;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isServerStatus(status: ts.Expression | undefined): boolean {
  if (!status) return false;
  if (ts.isNumericLiteral(status)) return Number(status.text) >= 500;
  return (
    ts.isPropertyAccessExpression(status) &&
    ts.isIdentifier(status.expression) &&
    status.expression.text === 'HttpStatus' &&
    SERVER_ERROR_STATUSES.has(status.name.text)
  );
}

/** The exception name and its options argument, when `thrown` builds a 5xx. */
function serverError(
  thrown: ts.NewExpression,
): { exception: string; options: ts.Expression | undefined } | undefined {
  if (!ts.isIdentifier(thrown.expression)) return undefined;
  const exception = thrown.expression.text;
  const args = thrown.arguments ?? [];
  if (SERVER_ERROR_EXCEPTIONS.has(exception)) {
    return { exception, options: args[1] };
  }
  if (exception === 'HttpException' && isServerStatus(args[1])) {
    return { exception, options: args[2] };
  }
  return undefined;
}

function passesReportableCause(options: ts.Expression | undefined): boolean {
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'cause' &&
      ts.isCallExpression(property.initializer) &&
      ts.isIdentifier(property.initializer.expression) &&
      property.initializer.expression.text === 'toReportableError',
  );
}

/** A function passed as `.catch(handler)` or `.then(onFulfilled, handler)`. */
function rejectionHandler(
  node: ts.Node,
): ts.FunctionLikeDeclaration | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const method = node.expression.name.text;
  const handler =
    method === 'catch'
      ? node.arguments[0]
      : method === 'then'
        ? node.arguments[1]
        : undefined;
  return handler && isFunctionLike(handler) ? handler : undefined;
}

/** Every 5xx `throw new` that runs in a catch clause or rejection handler. */
function serverErrorsThrownFromCatch(source: ts.SourceFile): RethrowSite[] {
  const sites: RethrowSite[] = [];

  const judge = (node: ts.Node): void => {
    // Each catch clause and handler is judged once, from the walk below.
    if (
      ts.isCatchClause(node) ||
      isFunctionLike(node) ||
      ts.isClassLike(node)
    ) {
      return;
    }
    if (
      ts.isThrowStatement(node) &&
      node.expression &&
      ts.isNewExpression(node.expression)
    ) {
      const built = serverError(node.expression);
      if (built) {
        sites.push({
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          exception: built.exception,
          hasCause: passesReportableCause(built.options),
        });
      }
    }
    node.forEachChild(judge);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) node.block.forEachChild(judge);
    const handler = rejectionHandler(node);
    if (handler?.body) handler.body.forEachChild(judge);
    node.forEachChild(visit);
  };
  visit(source);
  return sites;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

describe('5xx rethrown from a catch keeps its cause (#2131)', () => {
  const sources = collectApiSources(
    (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
  );
  const sites = sources.flatMap((file) =>
    serverErrorsThrownFromCatch(parse(file, readFileSync(file, 'utf8'))).map(
      (site) => ({ ...site, file: relative(SRC_ROOT, file) }),
    ),
  );

  it('is reading the real source tree', () => {
    expect(sources.length).toBeGreaterThan(100);
    // Anchors the scan: the portal 503 is a known catch-and-rethrow, so an
    // empty result means the walk broke, not that the tree is clean.
    expect(sites).toContainEqual(
      expect.objectContaining({
        file: 'application/services/billing.service.ts',
        exception: 'ServiceUnavailableException',
      }),
    );
  });

  it('passes `cause: toReportableError(…)` at every site', () => {
    const missing = sites
      .filter((site) => !site.hasCause)
      .map((site) => `${site.file}:${site.line} ${site.exception}`);
    expect(missing).toEqual([]);
  });

  describe('the detector', () => {
    const judged = (body: string): RethrowSite[] =>
      serverErrorsThrownFromCatch(parse('fixture.ts', body));
    const causes = (body: string): boolean[] =>
      judged(body).map((site) => site.hasCause);

    it('flags a catch that drops the error', () => {
      expect(
        judged(`
          try { await call(); } catch (error) {
            throw new ServiceUnavailableException('down');
          }
        `),
      ).toEqual([
        { line: 3, exception: 'ServiceUnavailableException', hasCause: false },
      ]);
    });

    it('flags options without a cause, and a catch with no binding', () => {
      expect(
        causes(`
          try { a(); } catch (error) {
            throw new BadGatewayException('x', { description: 'y' });
          }
          try { b(); } catch {
            throw new InternalServerErrorException('z');
          }
        `),
      ).toEqual([false, false]);
    });

    it('accepts only a cause that went through toReportableError', () => {
      // A raw catch binding may be a plain PostgREST object, which LinkedErrors
      // silently skips, so the key alone proves nothing.
      expect(
        causes(`
          try { a(); } catch (error) {
            throw new ServiceUnavailableException('x', { cause: toReportableError(error) });
          }
          try { b(); } catch (error) {
            throw new ServiceUnavailableException('y', { cause: error });
          }
          try { c(); } catch (cause) {
            throw new GatewayTimeoutException('z', { cause });
          }
        `),
      ).toEqual([true, false, false]);
    });

    it('judges .catch handlers and .then rejection handlers like catch clauses', () => {
      expect(
        causes(`
          call().catch((error) => {
            throw new BadGatewayException('x');
          });
          call().then(
            () => { throw new BadGatewayException('fulfilled path, not judged'); },
            function (error) {
              throw new BadGatewayException('y', { cause: toReportableError(error) });
            },
          );
        `),
      ).toEqual([false, true]);
    });

    it('covers HttpException with a 5xx status, and ignores one with a 4xx', () => {
      expect(
        judged(`
          try { a(); } catch (error) {
            throw new HttpException('down', HttpStatus.SERVICE_UNAVAILABLE);
          }
          try { b(); } catch (error) {
            throw new HttpException('down', 502, { cause: toReportableError(error) });
          }
          try { c(); } catch (error) {
            throw new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS);
          }
        `).map(({ exception, hasCause }) => ({ exception, hasCause })),
      ).toEqual([
        { exception: 'HttpException', hasCause: false },
        { exception: 'HttpException', hasCause: true },
      ]);
    });

    it('judges a nested try inside a catch, and a nested catch on its own', () => {
      expect(
        judged(`
          try { a(); } catch (outer) {
            try { b(); } catch (inner) {
              throw new BadGatewayException('inner', { cause: toReportableError(inner) });
            }
            throw new BadGatewayException('outer');
          }
        `),
      ).toEqual([
        { line: 6, exception: 'BadGatewayException', hasCause: false },
        { line: 4, exception: 'BadGatewayException', hasCause: true },
      ]);
    });

    it('does not judge what it says it does not: outside a catch, 4xx, declared functions, helpers', () => {
      // Pinned so the docblock's list of what a green run does NOT prove stays
      // true: widen the detector and this test is the one to change.
      expect(
        judged(`
          throw new ServiceUnavailableException('not configured');
          try {
            throw new ServiceUnavailableException('in the try block');
          } catch (error) {
            const later = () => {
              throw new ServiceUnavailableException('runs elsewhere');
            };
            throw new BadRequestException('client error');
          }
          try { d(); } catch (error) {
            throw this.unavailable(error);
          }
        `),
      ).toEqual([]);
    });
  });
});
