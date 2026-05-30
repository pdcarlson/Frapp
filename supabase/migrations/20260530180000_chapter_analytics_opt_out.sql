-- Analytics (#464): per-chapter opt-out for the pseudonymous analytics pipeline.
--
-- Chapter presidents can disable analytics for their chapter (spec:
-- spec/behavior/data-retention.md #analytics-events-pseudonymous). The flag is
-- read server-side as defense in depth before any server-originated event is
-- sent (AnalyticsService.isChapterAnalyticsEnabled). The Settings toggle that
-- writes it is tracked separately as #466. Default false = analytics enabled.

alter table chapters
  add column if not exists analytics_opt_out boolean not null default false;
