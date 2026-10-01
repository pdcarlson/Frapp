import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DISCORD_IMPORT_VIEW_FIELDS,
  toDiscordImportView,
} from './discord-import-view';
import type { DiscordImport } from '#domain/entities/discord-import.entity';

const API_ROOT = join(__dirname, '..', '..', '..');

/**
 * An import row as `select('*')` returns it, every column populated. A
 * projection test against a sparse row proves nothing, because the fields it
 * should drop would be absent anyway.
 */
function fullImportRow(): DiscordImport {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    chapter_id: '11111111-1111-4111-8111-111111111111',
    created_by: '33333333-3333-4333-8333-333333333333',
    status: 'running',
    source: 'bot',
    guild_id: 'GUILD_SNOWFLAKE_SECRET',
    guild_name: 'Alpha Beta Discord',
    consent_acknowledged_at: '2026-09-29T00:00:00.000Z',
    role_mapping: [],
    storage_prefix: 'chapters/STORAGE_PREFIX_SECRET/discord',
    total_messages: 120,
    imported_messages: 80,
    messages_skipped: 2,
    attachments_imported: 5,
    attachments_skipped: 1,
    parts_total: 3,
    cursor_part_index: 1,
    cursor_message_index: 17,
    cursor_part_message_count: 40,
    warnings: ['#old-general: 1 attachment had no uploaded file'],
    error: null,
    lock_token: 'LOCK_TOKEN_SECRET',
    locked_by: 'REPLICA_ID_SECRET',
    lease_expires_at: '2026-10-01T03:00:00.000Z',
    attempt_count: 2,
    created_at: '2026-09-29T00:00:00.000Z',
    updated_at: '2026-10-01T02:59:00.000Z',
    completed_at: null,
    purged_at: null,
    purged_messages: 0,
    cleared_at: null,
    messages_after: '2026-01-01T00:00:00.000Z',
  };
}

const INTERNAL_FIELDS = [
  'lock_token',
  'locked_by',
  'lease_expires_at',
  'attempt_count',
  'cursor_part_index',
  'cursor_message_index',
  'cursor_part_message_count',
  'parts_total',
  'storage_prefix',
  'guild_id',
] as const;

interface OpenApiSchema {
  $ref?: string;
  type?: string;
  items?: OpenApiSchema;
  properties?: Record<string, unknown>;
  allOf?: OpenApiSchema[];
}

interface OpenApiDocument {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: OpenApiSchema }> }
        >;
      }
    >
  >;
  components: { schemas: Record<string, OpenApiSchema> };
}

function openApi(): OpenApiDocument {
  return JSON.parse(
    readFileSync(join(API_ROOT, 'openapi.json'), 'utf8'),
  ) as OpenApiDocument;
}

/** Every property a schema declares, following `allOf` for an extended DTO. */
function schemaProperties(doc: OpenApiDocument, name: string): string[] {
  const walk = (schema: OpenApiSchema | undefined): string[] => {
    if (!schema) return [];
    if (schema.$ref) {
      return walk(doc.components.schemas[schema.$ref.split('/').pop() ?? '']);
    }
    return [
      ...Object.keys(schema.properties ?? {}),
      ...(schema.allOf ?? []).flatMap(walk),
    ];
  };
  return [...new Set(walk(doc.components.schemas[name]))].sort();
}

/** The schema name a route's success response points at, unwrapping arrays. */
function successSchema(
  doc: OpenApiDocument,
  path: string,
  method: string,
): string | undefined {
  const responses = doc.paths[path]?.[method]?.responses ?? {};
  const success = responses['200'] ?? responses['201'];
  let schema = success?.content?.['application/json']?.schema;
  if (schema?.type === 'array') schema = schema.items;
  return schema?.$ref?.split('/').pop();
}

describe('toDiscordImportView (#2860)', () => {
  it.each(INTERNAL_FIELDS)('omits %s', (field) => {
    expect(toDiscordImportView(fullImportRow())).not.toHaveProperty(field);
  });

  it('leaves no internal value anywhere in the payload', () => {
    const serialized = JSON.stringify(toDiscordImportView(fullImportRow()));

    for (const secret of [
      'LOCK_TOKEN_SECRET',
      'REPLICA_ID_SECRET',
      'STORAGE_PREFIX_SECRET',
      'GUILD_SNOWFLAKE_SECRET',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('returns exactly the allowlisted columns of a full row', () => {
    const view = toDiscordImportView(fullImportRow());

    expect(Object.keys(view).sort()).toEqual(
      [...DISCORD_IMPORT_VIEW_FIELDS].sort(),
    );
    expect(view).toMatchObject({
      id: '44444444-4444-4444-8444-444444444444',
      status: 'running',
      source: 'bot',
      imported_messages: 80,
      messages_after: '2026-01-01T00:00:00.000Z',
    });
  });

  it('keeps a column added later out until it is allowlisted', () => {
    // The default-deny property: the next migration's column must not reach
    // the browser just because `select('*')` returns it.
    const row = {
      ...fullImportRow(),
      worker_secret_added_later: 'NEW_COLUMN_SECRET',
    } as DiscordImport;

    expect(JSON.stringify(toDiscordImportView(row))).not.toContain(
      'NEW_COLUMN_SECRET',
    );
  });

  it('carries the progress counts when list or detail computed them', () => {
    const view = toDiscordImportView({
      ...fullImportRow(),
      channels_total: 12,
      channels_done: 4,
    });

    expect(view.channels_total).toBe(12);
    expect(view.channels_done).toBe(4);
  });

  it('adds no progress keys to a row that has none', () => {
    const view = toDiscordImportView(fullImportRow());

    expect(view).not.toHaveProperty('channels_total');
    expect(view).not.toHaveProperty('channels_done');
  });

  it('leaves an absent column absent rather than undefined', () => {
    const { messages_after: _omitted, ...sparse } = fullImportRow();

    expect(
      'messages_after' in toDiscordImportView(sparse as DiscordImport),
    ).toBe(false);
  });

  describe('the contract declares what the view returns', () => {
    // The contract is generated from the DTOs, the payload from the allowlist.
    // A field added to one and not the other is a contract that lies, and a
    // route that drops its response type goes back to an undeclared payload.
    // Read from `openapi.json`, which `check:api-contract` keeps in step with
    // the DTOs.
    it('DiscordImportResponseDto lists the allowlist exactly', () => {
      expect(schemaProperties(openApi(), 'DiscordImportResponseDto')).toEqual(
        [...DISCORD_IMPORT_VIEW_FIELDS].sort(),
      );
    });

    it('DiscordImportWithProgressResponseDto adds only the progress counts', () => {
      expect(
        schemaProperties(openApi(), 'DiscordImportWithProgressResponseDto'),
      ).toEqual(
        [
          ...DISCORD_IMPORT_VIEW_FIELDS,
          'channels_total',
          'channels_done',
        ].sort(),
      );
    });

    it.each([
      ['/v1/discord-imports', 'get', 'DiscordImportWithProgressResponseDto'],
      [
        '/v1/discord-imports/{id}',
        'get',
        'DiscordImportWithProgressResponseDto',
      ],
      ['/v1/discord-imports', 'post', 'DiscordImportResponseDto'],
      ['/v1/discord-imports/{id}/roles', 'put', 'DiscordImportResponseDto'],
      ['/v1/discord-imports/{id}/start', 'post', 'DiscordImportResponseDto'],
      ['/v1/discord-imports/{id}/cancel', 'post', 'DiscordImportResponseDto'],
      ['/v1/discord-imports/{id}/clear', 'post', 'DiscordImportResponseDto'],
      ['/v1/discord-imports/{id}', 'delete', 'DiscordImportResponseDto'],
    ])('%s %s returns %s', (path, method, schema) => {
      expect(successSchema(openApi(), path, method)).toBe(schema);
    });
  });
});
