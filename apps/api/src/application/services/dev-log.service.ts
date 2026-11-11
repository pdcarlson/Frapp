import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  RELEASE_NOTES,
  type ReleaseNote,
} from '@repo/validation';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { constantTimeEquals } from '#domain/utils/constant-time';

/**
 * The team's Dev log channel (#4145): GitHub Actions posts into one channel of
 * one chapter when work starts, a PR merges, once a day, and when an update
 * ships.
 *
 * Three variables switch it on, all or none. Unset, the route answers 404 and
 * local dev, tests, CI and staging need nothing.
 *
 * - `DEV_LOG_TOKEN_SHA256`: the SHA-256 (64 hex characters) of the bearer
 *   token the workflow sends. The API never holds the token itself; its only
 *   copy is the GitHub `automation` environment secret `DEV_LOG_TOKEN`.
 * - `DEV_LOG_CHAPTER_ID` and `DEV_LOG_CHANNEL_ID`: where posts go. The caller
 *   names neither, so the token can reach nothing else.
 *
 * Revoking is deleting `DEV_LOG_TOKEN_SHA256` (or replacing it with a new
 * token's hash) and redeploying. How to issue one:
 * `docs/internal/environment/ENV_REFERENCE.md` § Dev log channel.
 */
export const DEV_LOG_ENV = {
  tokenHash: 'DEV_LOG_TOKEN_SHA256',
  chapterId: 'DEV_LOG_CHAPTER_ID',
  channelId: 'DEV_LOG_CHANNEL_ID',
} as const;

/** The one repository posts link to. The caller sends numbers, never URLs. */
export const DEV_LOG_REPO_URL = 'https://github.com/pdcarlson/Frapp';

export const DEV_LOG_EVENTS = [
  'work_started',
  'pr_merged',
  'daily_summary',
  'update_pushed',
] as const;
export type DevLogEvent = (typeof DEV_LOG_EVENTS)[number];

export interface DevLogItem {
  number: number;
  title: string;
  actor?: string;
  areas?: string[];
}

export interface DevLogMergeCount {
  actor: string;
  count: number;
}

export type DevLogPost =
  | {
      event: 'work_started';
      number: number;
      title: string;
      actor: string;
      areas?: string[];
      /** Other issues in progress that share one of `areas`. */
      also_in_area?: DevLogItem[];
    }
  | { event: 'pr_merged'; number: number; title: string; actor: string }
  | {
      event: 'daily_summary';
      /** The day the summary is posted, `YYYY-MM-DD`. One post per day. */
      date: string;
      /** Pull requests merged in the last day, bots excluded. */
      merged_total?: number;
      /** That total, per person. */
      merged_by?: DevLogMergeCount[];
      in_progress?: DevLogItem[];
    }
  | {
      event: 'update_pushed';
      /** The Deploy production run that shipped it. One post per run. */
      run_id: string;
      /** That run also uploaded a store build for testers. */
      store_build?: boolean;
      /** That run also published an over-the-air update. */
      ota_update?: boolean;
    };

export interface DevLogConfig {
  tokenHash: string;
  chapterId: string;
  channelId: string;
}

type Env = Record<string, unknown>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function envValue(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Boot-time check, called from `validateEnv`. A half-set or malformed trio
 * refuses to boot: read as "off" it would hide a typo, and a channel id that
 * is not a uuid would only fail at the first post.
 */
export function validateDevLogEnv(env: Env): string[] {
  const tokenHash = envValue(env, DEV_LOG_ENV.tokenHash);
  const chapterId = envValue(env, DEV_LOG_ENV.chapterId);
  const channelId = envValue(env, DEV_LOG_ENV.channelId);
  const set = [tokenHash, chapterId, channelId].filter(
    (value) => value !== undefined,
  ).length;
  if (set === 0) return [];

  const problems: string[] = [];
  if (set < 3) {
    problems.push(
      `${DEV_LOG_ENV.tokenHash}, ${DEV_LOG_ENV.chapterId} and ${DEV_LOG_ENV.channelId} must be set together, or all left unset to turn the Dev log off.`,
    );
  }
  if (tokenHash !== undefined && !SHA256_HEX.test(tokenHash.toLowerCase())) {
    problems.push(
      `${DEV_LOG_ENV.tokenHash} must be the SHA-256 of the token as 64 hex characters, never the token itself.`,
    );
  }
  for (const [name, value] of [
    [DEV_LOG_ENV.chapterId, chapterId],
    [DEV_LOG_ENV.channelId, channelId],
  ] as const) {
    if (value !== undefined && !UUID.test(value)) {
      problems.push(`${name} must be a uuid.`);
    }
  }
  return problems;
}

/** The configuration, or `null` when the Dev log is off. */
export function resolveDevLogConfig(env: Env): DevLogConfig | null {
  const tokenHash = envValue(env, DEV_LOG_ENV.tokenHash)?.toLowerCase();
  const chapterId = envValue(env, DEV_LOG_ENV.chapterId);
  const channelId = envValue(env, DEV_LOG_ENV.channelId);
  if (!tokenHash || !chapterId || !channelId) return null;
  if (!SHA256_HEX.test(tokenHash)) return null;
  return { tokenHash, chapterId, channelId };
}

export function hashDevLogToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueUrl(number: number): string {
  return `${DEV_LOG_REPO_URL}/issues/${number}`;
}

function pullUrl(number: number): string {
  return `${DEV_LOG_REPO_URL}/pull/${number}`;
}

/** One line of text: titles and names arrive from GitHub and may hold breaks. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function areaList(areas: readonly string[] | undefined): string {
  return (areas ?? []).map(oneLine).filter(Boolean).join(', ');
}

function itemLine(item: DevLogItem, url: string): string {
  const parts = [`${oneLine(item.title)} (#${item.number})`];
  if (item.actor) parts.push(oneLine(item.actor));
  const areas = areaList(item.areas);
  if (areas) parts.push(areas);
  return `• ${parts.join(' · ')}\n  ${url}`;
}

function whatsNewBlock(note: ReleaseNote | undefined): string[] {
  if (!note) return [];
  return [
    '',
    `What's new (${note.date}): ${note.title}`,
    ...note.changes.map((change) => `• ${change}`),
  ];
}

function truncate(content: string): string {
  if (content.length <= CHAT_MESSAGE_CONTENT_MAX_LENGTH) return content;
  const tail = '\n… (cut short)';
  return content.slice(0, CHAT_MESSAGE_CONTENT_MAX_LENGTH - tail.length) + tail;
}

/**
 * The post's words. Plain text with bare links: the row is a `text` message
 * from the system sender, so both clients draw it as Frapp's and make the
 * links tappable. `note` is the newest What's new entry of this deployment.
 */
export function formatDevLogPost(
  post: DevLogPost,
  note: ReleaseNote | undefined = RELEASE_NOTES[0],
): string {
  switch (post.event) {
    case 'work_started': {
      const lines = [
        `${oneLine(post.actor)} started: ${oneLine(post.title)} (#${post.number})`,
      ];
      const areas = areaList(post.areas);
      if (areas) lines.push(`Area: ${areas}`);
      lines.push(issueUrl(post.number));
      const others = post.also_in_area ?? [];
      if (others.length > 0) {
        lines.push('', 'Also in progress in that area:');
        for (const item of others) {
          lines.push(itemLine(item, issueUrl(item.number)));
        }
      }
      return truncate(lines.join('\n'));
    }
    case 'pr_merged':
      return truncate(
        [
          `Merged: ${oneLine(post.title)} (#${post.number}) by ${oneLine(post.actor)}`,
          pullUrl(post.number),
        ].join('\n'),
      );
    case 'daily_summary': {
      const inProgress = post.in_progress ?? [];
      const lines = [`Dev log summary for ${post.date}`];
      // Counts, not titles: each merge already has its own post, and a busy
      // day is dozens of them.
      lines.push('', `Merged in the last day: ${post.merged_total ?? 0}`);
      for (const { actor, count } of post.merged_by ?? []) {
        lines.push(`• ${oneLine(actor)}: ${count}`);
      }
      lines.push('', `In progress now (${inProgress.length}):`);
      if (inProgress.length === 0) lines.push('• Nothing in progress.');
      for (const item of inProgress) {
        lines.push(itemLine(item, issueUrl(item.number)));
      }
      return truncate(lines.join('\n'));
    }
    case 'update_pushed': {
      const lines = [
        'Update pushed: please update.',
        '• Web: live now. Refresh the page to get it.',
      ];
      if (post.store_build) {
        lines.push(
          '• Phone app: a new build was uploaded for testers. Install it once TestFlight or Google Play offers it.',
        );
      }
      if (post.ota_update) {
        lines.push(
          '• Phone app: an update is out. Close the app fully and open it again to get it.',
        );
      }
      lines.push(...whatsNewBlock(note));
      return truncate(lines.join('\n'));
    }
  }
}

/**
 * The dedupe key (`idx_chat_messages_dedupe`), so a re-run workflow or a
 * retried request posts nothing twice: one "started" per issue, one "merged"
 * per PR, one summary per day, one update post per deploy run.
 */
export function devLogClientMessageId(post: DevLogPost): string {
  switch (post.event) {
    case 'work_started':
      return `devlog:work_started:${post.number}`;
    case 'pr_merged':
      return `devlog:pr_merged:${post.number}`;
    case 'daily_summary':
      return `devlog:daily_summary:${post.date}`;
    case 'update_pushed':
      return `devlog:update_pushed:${post.run_id}`;
  }
}

@Injectable()
export class DevLogService {
  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
  ) {}

  /**
   * 404 while the Dev log is off, so an unconfigured deployment (staging,
   * local) reads as having no such route; 401 for a missing or wrong token.
   * The comparison is between two fixed-width digests, in constant time.
   */
  assertToken(presented: string | undefined): void {
    const config = resolveDevLogConfig(process.env);
    if (!config) throw new NotFoundException();
    if (
      !presented ||
      !constantTimeEquals(hashDevLogToken(presented), config.tokenHash)
    ) {
      throw new UnauthorizedException('dev_log.token.invalid');
    }
  }

  /**
   * Post into the configured channel as Frapp. A `text` row from the system
   * sender, written through the repository because `ChatService.sendMessage`
   * refuses `SYSTEM_SENDER_ID` as a poster (as the poll and welcome notices
   * do). `text`, not `system_audit`: that kind draws its words unlinked and
   * defaults push to off, and a member who wants a ping here sets the channel
   * to All like any other.
   */
  async post(post: DevLogPost): Promise<'posted' | 'duplicate'> {
    const config = resolveDevLogConfig(process.env);
    if (!config) throw new NotFoundException();

    const channel = await this.channelRepo.findById(
      config.channelId,
      config.chapterId,
    );
    // A deleted or archived channel is a setup problem the workflow run
    // should show, not a post to drop quietly.
    if (!channel || channel.archived_at) {
      throw new NotFoundException('dev_log.channel.missing');
    }

    const result = await this.messageRepo.insertIdempotent({
      channel_id: channel.id,
      sender_id: SYSTEM_SENDER_ID,
      content: formatDevLogPost(post),
      kind: 'text',
      client_message_id: devLogClientMessageId(post),
    });
    return result === 'inserted' ? 'posted' : 'duplicate';
  }
}
