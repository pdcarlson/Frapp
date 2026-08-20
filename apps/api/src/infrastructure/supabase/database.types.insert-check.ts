/**
 * Compile-only proof that `TablesInsert` / `TablesUpdate` are accepted at the
 * write boundary without `as never`, and that a mistyped column is still
 * rejected. If GenericSchema silently degrades (the failure mode
 * `TableDefinition.Row` exists to prevent), the `@ts-expect-error` below
 * becomes unused and `tsc` fails this file.
 *
 * Not imported at runtime. Kept next to `database.types.ts` so `nest build`
 * (tsconfig.build.json) type-checks it.
 */
import type { Task } from '../../domain/entities/task.entity';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from './database.types';

export function insertCheck(
  client: FrappSupabaseClient,
  task: TablesInsert<'tasks'>,
  member: TablesInsert<'members'>,
  invite: TablesInsert<'invites'>,
  user: TablesInsert<'users'>,
  event: TablesInsert<'events'>,
  channel: TablesInsert<'chat_channels'>,
  audit: TablesInsert<'chapter_audit_log'>,
  taskPatch: TablesUpdate<'tasks'>,
  chapterPatch: TablesUpdate<'chapters'>,
): void {
  void client.from('tasks').insert(task);
  void client.from('members').insert(member);
  void client.from('invites').insert(invite);
  void client.from('users').insert(user);
  void client.from('events').insert(event);
  void client.from('chat_channels').insert(channel);
  void client.from('chapter_audit_log').insert(audit);
  void client.from('tasks').update(taskPatch);
  void client.from('chapters').update(chapterPatch);
  void client.from('invites').upsert(invite);
}

export function insertCheckRejectsMistypedColumn(
  client: FrappSupabaseClient,
): void {
  // @ts-expect-error title is a string on tasks
  void client.from('tasks').insert({ title: 123 });
}

/**
 * Domain repository interfaces stay `Partial<Entity>` (onion: domain must
 * not import `Database`). That shape is assignable to `TablesInsert` /
 * `TablesUpdate`, so the infrastructure method can take the table type and
 * still implement the domain interface.
 */
export function domainPartialIsAssignableToInsert(
  task: Partial<Task>,
): TablesInsert<'tasks'> {
  return task;
}
