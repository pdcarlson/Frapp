import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

export interface AttendanceReportRow {
  member_name: string;
  event_name: string;
  event_date: string;
  status: string;
  check_in_time: string | null;
}

export interface PointsReportRow {
  member_name: string;
  total_points: number;
  breakdown_by_category: Record<string, number>;
}

export interface RosterReportRow {
  name: string;
  email: string;
  roles: string[];
  join_date: string;
  point_balance: number;
}

export interface ServiceReportRow {
  member_name: string;
  date: string;
  duration_minutes: number;
  description: string;
  status: string;
}

export interface AttendanceReportInput {
  event_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface PointsReportInput {
  user_id?: string;
  window?: string;
}

export interface ServiceReportInput {
  user_id?: string;
  start_date?: string;
  end_date?: string;
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async getAttendanceReport(
    chapterId: string,
    input: AttendanceReportInput,
  ): Promise<AttendanceReportRow[]> {
    // First get event IDs for the chapter (with optional filters)
    let eventQuery = this.supabase
      .from('events')
      .select('id')
      .eq('chapter_id', chapterId);

    if (input.event_id) {
      eventQuery = eventQuery.eq('id', input.event_id);
    }
    if (input.start_date) {
      eventQuery = eventQuery.gte(
        'start_time',
        `${input.start_date}T00:00:00.000Z`,
      );
    }
    if (input.end_date) {
      eventQuery = eventQuery.lte(
        'start_time',
        `${input.end_date}T23:59:59.999Z`,
      );
    }

    const { data: eventsData, error: eventsError } = await eventQuery;
    if (eventsError) throw eventsError;
    const eventIds = (eventsData ?? []).map((e) => e.id);
    if (eventIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('event_attendance')
      .select(
        `
        status,
        check_in_time,
        event_id,
        events (id, name, start_time),
        users (display_name)
      `,
      )
      .in('event_id', eventIds);

    if (error) throw error;

    const rows = (data ?? []).map((row: Record<string, unknown>) => {
      const events = row.events as Record<string, unknown> | null;
      const users = row.users as Record<string, unknown> | null;
      const startTime = events?.start_time as string;
      const eventDate = startTime ? startTime.split('T')[0] : '';

      return {
        member_name: (users?.display_name as string) ?? '',
        event_name: (events?.name as string) ?? '',
        event_date: eventDate,
        status: (row.status as string) ?? '',
        check_in_time: (row.check_in_time as string) ?? null,
      };
    });

    rows.sort((a, b) =>
      (a.event_date + a.member_name).localeCompare(
        b.event_date + b.member_name,
      ),
    );
    return rows;
  }

  async getPointsReport(
    chapterId: string,
    input: PointsReportInput,
  ): Promise<PointsReportRow[]> {
    let query = this.supabase
      .from('point_transactions')
      .select('user_id, amount, category')
      .eq('chapter_id', chapterId);

    if (input.user_id) {
      query = query.eq('user_id', input.user_id);
    }
    if (input.window) {
      // Window could be a semester; for now we don't have a formal window column
      // so we ignore it unless we add created_at filtering
      // Placeholder: could filter by created_at if window is date range
    }

    const { data: txns, error } = await query;
    if (error) throw error;

    const byUser = new Map<
      string,
      { total: number; byCategory: Record<string, number> }
    >();

    for (const t of txns ?? []) {
      const uid = t.user_id as string;
      if (!byUser.has(uid)) {
        byUser.set(uid, { total: 0, byCategory: {} });
      }
      const entry = byUser.get(uid)!;
      entry.total += (t.amount as number) ?? 0;
      const cat = (t.category as string) ?? 'OTHER';
      entry.byCategory[cat] =
        (entry.byCategory[cat] ?? 0) + (t.amount as number);
    }

    const userIds = [...byUser.keys()];
    if (userIds.length === 0) return [];

    const { data: users, error: userError } = await this.supabase
      .from('users')
      .select('id, display_name')
      .in('id', userIds);

    if (userError) throw userError;

    const userMap = new Map(
      (users ?? []).map((u) => [u.id, u.display_name as string]),
    );

    return userIds.map((uid) => {
      const entry = byUser.get(uid)!;
      return {
        member_name: userMap.get(uid) ?? '',
        total_points: entry.total,
        breakdown_by_category: entry.byCategory,
      };
    });
  }

  async getRosterReport(chapterId: string): Promise<RosterReportRow[]> {
    const { data: members, error: memberError } = await this.supabase
      .from('members')
      .select('user_id, role_ids, created_at')
      .eq('chapter_id', chapterId);

    if (memberError) throw memberError;
    if (!members?.length) return [];

    const userIds = members.map((m) => m.user_id);
    const { data: users, error: userError } = await this.supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    if (userError) throw userError;

    const userMap = new Map(
      (users ?? []).map((u) => [
        u.id,
        { display_name: u.display_name, email: u.email },
      ]),
    );

    const { data: allTxns } = await this.supabase
      .from('point_transactions')
      .select('user_id, amount')
      .eq('chapter_id', chapterId)
      .in('user_id', userIds);

    const balances = new Map<string, number>();
    for (const t of allTxns ?? []) {
      const uid = t.user_id as string;
      balances.set(uid, (balances.get(uid) ?? 0) + ((t.amount as number) ?? 0));
    }

    const roleIds = [...new Set(members.flatMap((m) => m.role_ids ?? []))];
    const roleMap = new Map<string, string>();
    if (roleIds.length > 0) {
      const { data: roles } = await this.supabase
        .from('roles')
        .select('id, name')
        .eq('chapter_id', chapterId)
        .in('id', roleIds);
      for (const r of roles ?? []) {
        roleMap.set(r.id, r.name);
      }
    }

    return members.map((m) => {
      const u = userMap.get(m.user_id);
      const roleNames = (m.role_ids ?? []).map(
        (rid: string) => roleMap.get(rid) ?? rid,
      );
      return {
        name: (u?.display_name as string) ?? '',
        email: (u?.email as string) ?? '',
        roles: roleNames,
        join_date: (m.created_at as string)?.split('T')[0] ?? '',
        point_balance: balances.get(m.user_id) ?? 0,
      };
    });
  }

  async getServiceReport(
    chapterId: string,
    input: ServiceReportInput,
  ): Promise<ServiceReportRow[]> {
    let query = this.supabase
      .from('service_entries')
      .select('user_id, date, duration_minutes, description, status')
      .eq('chapter_id', chapterId);

    if (input.user_id) {
      query = query.eq('user_id', input.user_id);
    }
    if (input.start_date) {
      query = query.gte('date', input.start_date);
    }
    if (input.end_date) {
      query = query.lte('date', input.end_date);
    }

    const { data: entries, error } = await query.order('date', {
      ascending: false,
    });

    if (error) throw error;
    if (!entries?.length) return [];

    const userIds = [...new Set(entries.map((e) => e.user_id))];
    const { data: users } = await this.supabase
      .from('users')
      .select('id, display_name')
      .in('id', userIds);

    const userMap = new Map(
      (users ?? []).map((u) => [u.id, u.display_name as string]),
    );

    return entries.map((e) => ({
      member_name: userMap.get(e.user_id) ?? '',
      date: e.date,
      duration_minutes: e.duration_minutes,
      description: e.description,
      status: e.status,
    }));
  }
}
