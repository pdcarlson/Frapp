-- Backwork AI fill: one fill at a time per draft (#5233,
-- spec/behavior/backwork.md § AI fill). The API sets this when a fill starts
-- reading a draft's file and clears it when the fill ends, with a conditional
-- update that only one request can win, so a draft's file is read by one fill
-- at a time even with several API instances. A claim older than the API's
-- staleness window counts as free, so a fill cut off mid-way (a restart)
-- never locks the draft for good.

alter table public.backwork_resources
  add column if not exists ai_fill_started_at timestamptz;
