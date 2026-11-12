import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * Keeps `database.types.ts` in alphabetical order (#4558 item 4).
 *
 * Every PR that adds a table or an RPC edits this file, and each one used to
 * append its entry at the end of `Tables` or `Functions` (and its entity at
 * the end of the `#domain/entities` import). Two such PRs then always
 * conflicted on the same line. Sorted, two new entries land in different
 * places and merge cleanly.
 *
 * Order is by plain code-unit comparison (`a < b`), so `_` sorts before
 * letters: `chat_message_actions` comes before `chat_messages`. The failure
 * names where the out-of-place entry belongs, so there is nothing to work out
 * by hand.
 *
 * What is judged: the named imports from `#domain/entities`, and the keys of
 * every group under `Database['public']` written as a type literal (`Tables`,
 * `Views`, `Functions`, `Enums`, `CompositeTypes`; the ones that are
 * `Record<string, never>` today have no keys to order).
 */
const FILE = join(__dirname, 'database.types.ts');
const source = ts.createSourceFile(
  FILE,
  readFileSync(FILE, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);

function propertyName(member: ts.TypeElement): string {
  if (!member.name) throw new Error('database.types.ts: unnamed member');
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
    return member.name.text;
  }
  throw new Error(
    `database.types.ts: unsupported member name ${member.name.getText(source)}`,
  );
}

function typeLiteralMember(
  literal: ts.TypeLiteralNode | ts.InterfaceDeclaration,
  name: string,
): ts.PropertySignature {
  const found = literal.members.find(
    (m): m is ts.PropertySignature =>
      ts.isPropertySignature(m) && propertyName(m) === name,
  );
  if (!found) throw new Error(`database.types.ts: no \`${name}\` member`);
  return found;
}

/**
 * Names out of place, each with the name it should come right after.
 *
 * "Out of place" means outside the longest run that is already in order, so
 * one entry appended at the end reports that entry alone, not every name it
 * shifted.
 */
function misplaced(names: string[]): string[] {
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const runLength = names.map(() => 1);
  const previous = names.map(() => -1);
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < i; j++) {
      if (names[j] < names[i] && runLength[j] + 1 > runLength[i]) {
        runLength[i] = runLength[j] + 1;
        previous[i] = j;
      }
    }
  }
  const inOrder = new Set<number>();
  let at = runLength.indexOf(Math.max(0, ...runLength));
  while (at !== -1) {
    inOrder.add(at);
    at = previous[at];
  }
  return names.flatMap((name, i) => {
    if (inOrder.has(i)) return [];
    const position = sorted.indexOf(name);
    const where =
      position === 0 ? 'at the top' : `after \`${sorted[position - 1]}\``;
    return [`\`${name}\` belongs ${where}`];
  });
}

function databasePublicGroups(): Map<string, string[]> {
  const database = source.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === 'Database',
  );
  if (!database) throw new Error('database.types.ts: no `Database` interface');
  const publicSchema = typeLiteralMember(database, 'public').type;
  if (!publicSchema || !ts.isTypeLiteralNode(publicSchema)) {
    throw new Error('database.types.ts: `public` is not a type literal');
  }
  const groups = new Map<string, string[]>();
  for (const member of publicSchema.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    if (!ts.isTypeLiteralNode(member.type)) continue;
    groups.set(propertyName(member), member.type.members.map(propertyName));
  }
  return groups;
}

describe('database.types.ts stays alphabetical', () => {
  const groups = databasePublicGroups();

  it('finds the Tables and Functions groups', () => {
    expect([...groups.keys()]).toEqual(
      expect.arrayContaining(['Tables', 'Functions']),
    );
    expect(groups.get('Tables')?.length).toBeGreaterThan(0);
    expect(groups.get('Functions')?.length).toBeGreaterThan(0);
  });

  it.each([...groups.keys()])('sorts the keys of `%s`', (group) => {
    expect(misplaced(groups.get(group) ?? [])).toEqual([]);
  });

  it('sorts the names imported from `#domain/entities`', () => {
    const entities = source.statements.find(
      (s): s is ts.ImportDeclaration =>
        ts.isImportDeclaration(s) &&
        ts.isStringLiteral(s.moduleSpecifier) &&
        s.moduleSpecifier.text === '#domain/entities',
    );
    const bindings = entities?.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      throw new Error('database.types.ts: no named `#domain/entities` import');
    }
    const names = bindings.elements.map((e) => e.name.text);
    expect(names.length).toBeGreaterThan(0);
    expect(misplaced(names)).toEqual([]);
  });
});
