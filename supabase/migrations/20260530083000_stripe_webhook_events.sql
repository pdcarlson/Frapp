create table stripe_webhook_events (
  event_id              text         primary key,
  event_type            text         not null,
  processing_started_at timestamptz,
  processed_at          timestamptz,
  failed_at             timestamptz,
  last_error            text,
  attempts              integer      not null default 1 check (attempts > 0),
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now(),
  constraint stripe_webhook_events_terminal_state_check
    check (processed_at is null or failed_at is null)
);

create index idx_stripe_webhook_events_processing
  on stripe_webhook_events (processing_started_at)
  where processed_at is null;

create index idx_stripe_webhook_events_failed
  on stripe_webhook_events (failed_at)
  where failed_at is not null;

alter table stripe_webhook_events enable row level security;

create trigger trg_stripe_webhook_events_updated_at
  before update on stripe_webhook_events
  for each row execute function update_updated_at();
