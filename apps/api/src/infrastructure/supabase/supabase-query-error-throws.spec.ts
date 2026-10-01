import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import * as ts from 'typescript';
import {
  REPOSITORY_SRC_ROOT as SRC_ROOT,
  collectApiSources,
} from '#test/helpers/repository-corpus';

/**
 * A failed Supabase query is thrown as a `SupabaseQueryError`, never as the
 * raw `error` the query resolved with (#1264, which folded in #1404's ask for
 * a guard).
 *
 * That raw value is a plain `{ code, message, details, hint }` object, though
 * supabase-js types it as an `Error` subclass. The type is why nothing else
 * catches this: `@typescript-eslint/only-throw-error` reads the declared
 * `PostgrestError` and passes it. Thrown bare, it renders `[object Object]`,
 * defeats every `instanceof Error` branch, and reaches Sentry with a stack
 * rooted in `toReportableError` instead of the query. 281 sites threw it that
 * way before this ledger existed.
 *
 * What is judged, anywhere under `apps/api/src`:
 *
 *  - `throw x`, where the nearest binding of `x` in scope destructures a
 *    result's `error` property: `const { data, error } = await …` or
 *    `const { error: pageError } = …`.
 *  - `throw r.error`, for a result held whole.
 *
 * Both are exempt when the result came from `.storage` or `.auth`: storage-js
 * and auth-js construct `StorageError` and `AuthError`, which are real
 * `Error` subclasses already.
 *
 * Not judged, and stated so nobody reads more into a green run: an `error`
 * passed into a helper and thrown there (`report.service.ts` and
 * `search.service.ts` once each had a local `throwIfError`), destructuring by
 * assignment (`({ error } = …)`), and `const error = result.error`.
 */
interface RawThrow {
  line: number;
  thrown: string;
}

type FunctionLike = ts.FunctionLikeDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function bindsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindsName(element.name, name),
  );
}

/** Whether `pattern` binds `name` from a top-level `error` property. */
function bindsErrorProperty(binding: ts.BindingName, name: string): boolean {
  if (!ts.isObjectBindingPattern(binding)) return false;
  return binding.elements.some((element) => {
    if (!ts.isIdentifier(element.name) || element.name.text !== name) {
      return false;
    }
    const property = element.propertyName ?? element.name;
    return ts.isIdentifier(property) && property.text === 'error';
  });
}

/** The declaration lists a scope node declares directly. */
function declarationListsOf(scope: ts.Node): ts.VariableDeclarationList[] {
  if (
    ts.isBlock(scope) ||
    ts.isSourceFile(scope) ||
    ts.isModuleBlock(scope) ||
    ts.isCaseClause(scope) ||
    ts.isDefaultClause(scope)
  ) {
    return scope.statements
      .filter(ts.isVariableStatement)
      .map((statement) => statement.declarationList);
  }
  if (
    (ts.isForStatement(scope) ||
      ts.isForOfStatement(scope) ||
      ts.isForInStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    return [scope.initializer];
  }
  return [];
}

/**
 * The nearest declaration of `name` visible from `from`, walking out through
 * blocks and closures. A catch clause or parameter that shadows it ends the
 * search with no declaration: that binding is not a query result.
 */
function nearestDeclaration(
  name: string,
  from: ts.Node,
): ts.VariableDeclaration | undefined {
  for (let scope = from.parent; scope; scope = scope.parent) {
    if (
      ts.isCatchClause(scope) &&
      scope.variableDeclaration &&
      bindsName(scope.variableDeclaration.name, name)
    ) {
      return undefined;
    }
    if (
      isFunctionLike(scope) &&
      scope.parameters.some((parameter) => bindsName(parameter.name, name))
    ) {
      return undefined;
    }
    for (const list of declarationListsOf(scope)) {
      const declaration = list.declarations.find((candidate) =>
        bindsName(candidate.name, name),
      );
      if (declaration) return declaration;
    }
  }
  return undefined;
}

/** storage-js and auth-js throw real `Error` subclasses of their own. */
function fromStorageOrAuth(declaration: ts.VariableDeclaration): boolean {
  const initializer = declaration.initializer?.getText() ?? '';
  return /\.(storage|auth)\b/.test(initializer);
}

/** Every `throw` that hands on a query's raw `error`. */
function rawQueryErrorThrows(source: ts.SourceFile): RawThrow[] {
  const throws: RawThrow[] = [];
  const record = (node: ts.ThrowStatement): void => {
    throws.push({
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      thrown: node.expression.getText(source),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node) && node.expression) {
      const thrown = node.expression;
      if (ts.isIdentifier(thrown)) {
        const declaration = nearestDeclaration(thrown.text, node);
        if (
          declaration &&
          bindsErrorProperty(declaration.name, thrown.text) &&
          !fromStorageOrAuth(declaration)
        ) {
          record(node);
        }
      } else if (
        ts.isPropertyAccessExpression(thrown) &&
        thrown.name.text === 'error'
      ) {
        const holder = ts.isIdentifier(thrown.expression)
          ? nearestDeclaration(thrown.expression.text, node)
          : undefined;
        if (!holder || !fromStorageOrAuth(holder)) record(node);
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return throws;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

describe('a failed Supabase query is thrown as a SupabaseQueryError (#1264)', () => {
  const sources = collectApiSources(
    (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
  );
  const texts = sources.map((file) => ({
    file: relative(SRC_ROOT, file),
    text: readFileSync(file, 'utf8'),
  }));

  it('is reading the real source tree', () => {
    expect(sources.length).toBeGreaterThan(100);
    // Anchors the scan: an empty walk would pass the ledger below vacuously.
    const wrapped = texts.reduce(
      (count, { text }) =>
        count + (text.match(/new SupabaseQueryError\(/g)?.length ?? 0),
      0,
    );
    expect(wrapped).toBeGreaterThan(250);
  });

  it('throws no raw query error anywhere under apps/api/src', () => {
    const raw = texts.flatMap(({ file, text }) =>
      rawQueryErrorThrows(parse(file, text)).map(
        (site) => `${file}:${site.line} throw ${site.thrown}`,
      ),
    );
    expect(raw).toEqual([]);
  });

  describe('the detector', () => {
    const judged = (body: string): RawThrow[] =>
      rawQueryErrorThrows(parse('fixture.ts', body));

    it('flags the destructured error, by any name', () => {
      expect(
        judged(`
          async function a() {
            const { data, error } = await supabase.from('t').select();
            if (error) throw error;
          }
          async function b() {
            const { data: rows, error: pageError } = await query;
            if (pageError) {
              if (pageError.code === '23505') return null;
              throw pageError;
            }
          }
        `),
      ).toEqual([
        { line: 4, thrown: 'error' },
        { line: 10, thrown: 'pageError' },
      ]);
    });

    it('flags a result held whole and thrown by its error property', () => {
      expect(
        judged(`
          async function a() {
            const result = await supabase.rpc('f');
            if (result.error) throw result.error;
          }
        `),
      ).toEqual([{ line: 4, thrown: 'result.error' }]);
    });

    it('sees the binding from inside a closure', () => {
      expect(
        judged(`
          async function a() {
            const { error } = await supabase.from('t').delete();
            await Promise.resolve().then(() => {
              if (error) throw error;
            });
          }
        `),
      ).toEqual([{ line: 5, thrown: 'error' }]);
    });

    it('accepts the wrapped throw', () => {
      expect(
        judged(`
          async function a() {
            const { error } = await supabase.from('t').select();
            if (error) throw new SupabaseQueryError(error);
          }
        `),
      ).toEqual([]);
    });

    it('accepts storage-js and auth-js errors, which are real Errors', () => {
      expect(
        judged(`
          async function a() {
            const { error } = await this.supabase.storage.from('b').remove([p]);
            if (error) throw error;
            const { error: authError } = await this.supabase.auth.admin.deleteUser(id);
            if (authError) throw authError;
            const listed = await this.supabase.storage.from('b').list();
            if (listed.error) throw listed.error;
          }
        `),
      ).toEqual([]);
    });

    it('does not mistake a shadowing catch binding or parameter for a query result', () => {
      expect(
        judged(`
          async function a() {
            const { error } = await supabase.from('t').select();
            if (error) throw new SupabaseQueryError(error);
            try {
              await other();
            } catch (error) {
              if (!(error instanceof Conflict)) throw error;
            }
            const rethrow = (error: unknown) => { throw error; };
          }
        `),
      ).toEqual([]);
    });
  });
});
