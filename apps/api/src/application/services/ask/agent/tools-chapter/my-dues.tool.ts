import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { FinancialInvoiceService } from '../../../financial-invoice.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  fitRows,
  found,
  listSourceId,
  liveSource,
  longDay,
  nothing,
  quoted,
  todayLine,
} from './chapter-tool-kit';

const DUES_LIMIT = 20;

const input = z.object({});
type Args = z.infer<typeof input>;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The asker's own dues: `GET /v1/invoices` as a member reads it. What their
 * own Dues page shows: a draft is the treasurer's unfinished work and a void
 * invoice was withdrawn, so neither is read.
 */
@Injectable()
export class MyDuesAgentTool implements AgentReadTool<Args> {
  readonly name = 'my_dues';
  readonly description =
    "The asking member's own dues and invoices: what they owe in total, each invoice's amount and due date, and whether it is paid or past due.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  // Off for every chapter during the beta (`BETA_OFF_MODULES`), so this tool
  // is not offered until dues come back.
  readonly module = 'dues';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading your dues';

  constructor(private readonly invoices: FinancialInvoiceService) {}

  async run(_args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    const invoices = (await this.invoices.findByUser(userId, chapterId))
      .filter(
        (invoice) => invoice.status === 'OPEN' || invoice.status === 'PAID',
      )
      .sort((a, b) => b.due_date.localeCompare(a.due_date));
    if (invoices.length === 0) {
      return nothing(context, 'This member has no invoices.');
    }
    const unpaid = invoices.filter((invoice) => invoice.status === 'OPEN');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
      context.now,
    );
    const pastDue = unpaid.filter(
      (invoice) => invoice.due_date.slice(0, 10) < today,
    );
    const sum = (list: typeof invoices) =>
      list.reduce((total, invoice) => total + invoice.amount, 0);
    const summary = [
      todayLine(context),
      `You owe ${dollars(sum(unpaid))} across ${count(unpaid.length, 'unpaid invoice')}.`,
      `Past due: ${dollars(sum(pastDue))} across ${count(pastDue.length, 'invoice')}.`,
    ];
    const rows = invoices.map((invoice) =>
      invoice.status === 'PAID'
        ? `${quoted(invoice.title)}: ${dollars(invoice.amount)}, paid${invoice.paid_at ? ` on ${longDay(invoice.paid_at, timeZone)}` : ''}.`
        : `${quoted(invoice.title)}: ${dollars(invoice.amount)}, not paid, due ${longDay(invoice.due_date, timeZone)}${invoice.due_date.slice(0, 10) < today ? ', past due' : ''}.`,
    );
    const shown = fitRows(summary, rows, DUES_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'older invoice')} not listed here. The totals above include them.`
        : null;
    return found(
      context,
      liveSource({
        id: listSourceId(this.name),
        kind: 'dues',
        title: 'Your dues',
        page: 'dues',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      null,
      cutLine
        ? `Showing the newest ${shown.length} of ${rows.length} invoices.`
        : null,
    );
  }
}
