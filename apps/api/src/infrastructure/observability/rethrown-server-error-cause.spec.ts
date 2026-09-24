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
 * `all-exceptions.filter.spec.ts`).
 *
 * Seven sites had lost the cause before this lock existed, so the rule is
 * enforced here rather than trusted to review: inside a catch clause, `throw
 * new <5xx exception>(message, options)` must pass an object literal carrying
 * `cause`. A throw that sits in a function *declared* inside the catch is not
 * judged, because it runs later and elsewhere; a nested catch is judged on its
 * own.
 */
const SERVER_ERROR_EXCEPTIONS = new Set([
  'BadGatewayException',
  'GatewayTimeoutException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
]);

interface RethrowSite {
  line: number;
  exception: string;
  hasCause: boolean;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isClassLike(node)
  );
}

function passesCause(expression: ts.NewExpression): boolean {
  const options = expression.arguments?.[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'cause',
  );
}

/** Every 5xx `throw new` that runs in a catch clause of `source`. */
function serverErrorsThrownFromCatch(source: ts.SourceFile): RethrowSite[] {
  const sites: RethrowSite[] = [];

  const judge = (node: ts.Node): void => {
    // Each catch clause is judged once, from the outer walk below.
    if (ts.isCatchClause(node) || isFunctionLike(node)) return;
    if (
      ts.isThrowStatement(node) &&
      node.expression &&
      ts.isNewExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      SERVER_ERROR_EXCEPTIONS.has(node.expression.expression.text)
    ) {
      sites.push({
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        exception: node.expression.expression.text,
        hasCause: passesCause(node.expression),
      });
    }
    node.forEachChild(judge);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) node.block.forEachChild(judge);
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

  it('passes `cause` at every site', () => {
    const missing = sites
      .filter((site) => !site.hasCause)
      .map((site) => `${site.file}:${site.line} ${site.exception}`);
    expect(missing).toEqual([]);
  });

  describe('the detector', () => {
    const judged = (body: string): RethrowSite[] =>
      serverErrorsThrownFromCatch(parse('fixture.ts', body));

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

    it('flags options that do not carry cause, and a catch with no binding', () => {
      const found = judged(`
        try { a(); } catch (error) {
          throw new BadGatewayException('x', { description: 'y' });
        }
        try { b(); } catch {
          throw new InternalServerErrorException('z');
        }
      `);
      expect(found.map((site) => site.hasCause)).toEqual([false, false]);
    });

    it('accepts cause as a property or a shorthand', () => {
      const found = judged(`
        try { a(); } catch (error) {
          throw new ServiceUnavailableException('x', { cause: toReportableError(error) });
        }
        try { b(); } catch (cause) {
          throw new GatewayTimeoutException('y', { cause });
        }
      `);
      expect(found.map((site) => site.hasCause)).toEqual([true, true]);
    });

    it('judges a nested try inside a catch, and a nested catch on its own', () => {
      const found = judged(`
        try { a(); } catch (outer) {
          try { b(); } catch (inner) {
            throw new BadGatewayException('inner', { cause: inner });
          }
          throw new BadGatewayException('outer');
        }
      `);
      expect(found).toEqual([
        { line: 6, exception: 'BadGatewayException', hasCause: false },
        { line: 4, exception: 'BadGatewayException', hasCause: true },
      ]);
    });

    it('ignores throws outside a catch, 4xx throws, and functions declared in a catch', () => {
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
        `),
      ).toEqual([]);
    });
  });
});
