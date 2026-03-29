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

interface QueryError {
  message: string;
}

interface QueryResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

interface AttendanceJoinedRow {
  status: string;
  check_in_time: string | null;
  event_id: string;
  events: { id: string; name: string; start_time: string } | null;
  users: { display_name: string } | null;
}

interface UserNameRow {
  id: string;
  display_name: string;
}

interface MemberRosterRow {
  user_id: string;
  role_ids: string[];
  created_at: string;
}

interface UserRosterRow {
  id: string;
  display_name: string;
  email: string;
}

interface UserAmountRow {
  user_id: string;
  amount: number;
}

interface RoleNameRow {
  id: string;
  name: string;
}

interface ServiceEntryRow {
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  status: string;
}

interface PointsReportRpcRow {
  member_name: string;
  total_points: number;
  breakdown_by_category: Record<string, number>;
}

function throwIfError(error: QueryError | null): void {
  if (error) {
    throw new Error(error.message);
  }
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

    const { data: eventsData, error: eventsError } =
      (await eventQuery) as QueryResult<{ id: string }>;
    throwIfError(eventsError);
    const eventIds = (eventsData ?? []).map((e) => e.id);
    if (eventIds.length === 0) return [];

    const { data, error } = (await this.supabase
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
      .in('event_id', eventIds)) as QueryResult<AttendanceJoinedRow>;
    throwIfError(error);

    const rows = (data ?? []).map((row) => {
      const startTime = row.events?.start_time ?? '';
      const eventDate = startTime ? startTime.split('T')[0] : '';

      return {
        member_name: row.users?.display_name ?? '',
        event_name: row.events?.name ?? '',
        event_date: eventDate,
        status: row.status,
        check_in_time: row.check_in_time,
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
    const query = this.supabase.rpc('get_points_report', {
      p_chapter_id: chapterId,
      p_user_id: input.user_id || null,
      p_window: input.window || null,
    });

    const { data, error } = (await query) as QueryResult<PointsReportRpcRow>;
    throwIfError(error);

    return (data ?? []).map((row) => ({
      member_name: row.member_name,
      total_points: Number(row.total_points),
      breakdown_by_category: row.breakdown_by_category || {},
    }));
  }

  async getRosterReport(chapterId: string): Promise<RosterReportRow[]> {
    const { data: members, error: memberError } = (await this.supabase
      .from('members')
      .select('user_id, role_ids, created_at')
      .eq('chapter_id', chapterId)) as QueryResult<MemberRosterRow>;
    throwIfError(memberError);
    if (!members?.length) return [];

    const userIds = members.map((m) => m.user_id);
    const roleIds = [...new Set(members.flatMap((m) => m.role_ids ?? []))];

    // ⚡ Bolt: Parallelize independent DB queries to eliminate sequential
    // network roundtrips. Expected impact: Reduces latency during roster
    // generation by fetching users, points transactions, and roles concurrently.
    const promises: Promise<QueryResult<any>>[] = [
      this.supabase
        .from('users')
        .select('id, display_name, email')
        .in('id', userIds) as unknown as Promise<QueryResult<UserRosterRow>>,
      this.supabase
        .from('point_transactions')
        .select('user_id, amount')
        .eq('chapter_id', chapterId)
        .in('user_id', userIds) as unknown as Promise<
        QueryResult<UserAmountRow>
      >,
    ];

    if (roleIds.length > 0) {
      promises.push(
        this.supabase
          .from('roles')
          .select('id, name')
          .eq('chapter_id', chapterId)
          .in('id', roleIds) as unknown as Promise<QueryResult<RoleNameRow>>,
      );
    }

    const [usersResult, txnsResult, rolesResult] = (await Promise.all(
      promises,
    )) as [
      QueryResult<UserRosterRow>,
      QueryResult<UserAmountRow>,
      QueryResult<RoleNameRow> | undefined,
    ];

    throwIfError(usersResult.error);
    const users = usersResult.data;
    const allTxns = txnsResult.data;

    const userMap = new Map(
      (users ?? []).map((u) => [
        u.id,
        { display_name: u.display_name, email: u.email },
      ]),
    );

    const balances = new Map<string, number>();
    for (const t of allTxns ?? []) {
      const uid = t.user_id;
      balances.set(uid, (balances.get(uid) ?? 0) + (t.amount ?? 0));
    }

    const roleMap = new Map<string, string>();
    if (roleIds.length > 0 && rolesResult) {
      throwIfError(rolesResult.error);
      const roles = rolesResult.data;
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
        name: u?.display_name ?? '',
        email: u?.email ?? '',
        roles: roleNames,
        join_date: m.created_at.split('T')[0] ?? '',
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

    const { data: entries, error } = (await query.order('date', {
      ascending: false,
    })) as QueryResult<ServiceEntryRow>;
    throwIfError(error);
    if (!entries?.length) return [];

    const userIds = [...new Set(entries.map((e) => e.user_id))];
    const { data: users, error: usersError } = (await this.supabase
      .from('users')
      .select('id, display_name')
      .in('id', userIds)) as QueryResult<UserNameRow>;
    throwIfError(usersError);

    const userMap = new Map((users ?? []).map((u) => [u.id, u.display_name]));

    return entries.map((e) => ({
      member_name: userMap.get(e.user_id) ?? '',
      date: e.date,
      duration_minutes: e.duration_minutes,
      description: e.description,
      status: e.status,
    }));
  }
}
