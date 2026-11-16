-- Predictions (#5133, spec/behavior/predictions.md): members stake house
-- points on a chapter question, and the points staked on the losing answers
-- go to the members who staked on the winning one. Every movement is a
-- point_transactions row under the new PREDICTION category; the pool math runs
-- here, in functions that lock what they read, so the ledger stays zero-sum.
--
-- Additive: four new tables, one new column with a default, the ledger's
-- category CHECK widened by one value, four functions, and two permission
-- keys added to existing tiers.

-- ── Ledger category ──────────────────────────────────────────────────────────
-- Added NOT VALID, then validated: the validation scan takes only a SHARE
-- UPDATE EXCLUSIVE lock, so points reads and writes go on while it runs.
alter table point_transactions drop constraint if exists point_transactions_category_check;
alter table point_transactions add constraint point_transactions_category_check
  check (category in (
    'ATTENDANCE', 'ACADEMIC', 'SERVICE', 'FINE', 'MANUAL', 'STUDY', 'PREDICTION'
  )) not valid;
alter table point_transactions validate constraint point_transactions_category_check;

-- ── Per-market stake cap ─────────────────────────────────────────────────────
-- An absent chapter_points_config row is the default, as for the other limits.
alter table chapter_points_config
  add column if not exists prediction_max_stake int not null default 25
  check (prediction_max_stake >= 1);

-- ── Markets ──────────────────────────────────────────────────────────────────
create table if not exists prediction_markets (
  id                       uuid        primary key default gen_random_uuid(),
  chapter_id               uuid        not null references chapters(id) on delete cascade,
  channel_id               uuid        not null references chat_channels(id) on delete cascade,
  -- The chat card that shows it, once clients post one (web slice of #5133).
  message_id               uuid        references chat_messages(id) on delete set null,
  created_by               uuid        not null references users(id),
  settler_id               uuid        not null references users(id),
  named_member_id          uuid        references users(id),
  question                 text        not null check (char_length(question) between 1 and 200),
  settle_rule              text        not null check (char_length(settle_rule) between 1 and 1000),
  closes_at                timestamptz not null,
  status                   text        not null default 'open' check (status in (
                             'awaiting_consent', 'open', 'settled', 'questioned', 'paid', 'voided'
                           )),
  winning_answer_id        uuid,
  known_at                 timestamptz,
  settle_note              text        check (settle_note is null or char_length(settle_note) <= 500),
  settled_by               uuid        references users(id),
  settled_at               timestamptz,
  question_window_ends_at  timestamptz,
  -- Bumped each time payouts are reversed, so a correction inverts exactly the
  -- rows of the round it undoes and never a round already undone.
  payout_round             int         not null default 0,
  paid_at                  timestamptz,
  voided_by                uuid        references users(id),
  voided_at                timestamptz,
  client_message_id        uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists prediction_markets_create_dedupe
  on prediction_markets (chapter_id, client_message_id) where client_message_id is not null;
create index if not exists prediction_markets_chapter_status
  on prediction_markets (chapter_id, status, closes_at);
create index if not exists prediction_markets_payable
  on prediction_markets (question_window_ends_at) where status = 'settled';
alter table prediction_markets enable row level security;

drop trigger if exists trg_prediction_markets_updated_at on prediction_markets;
create trigger trg_prediction_markets_updated_at
  before update on prediction_markets
  for each row execute function update_updated_at();

create table if not exists prediction_answers (
  id         uuid primary key default gen_random_uuid(),
  market_id  uuid not null references prediction_markets(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 80),
  position   int  not null check (position >= 0),
  unique (market_id, position)
);
alter table prediction_answers enable row level security;

alter table prediction_markets
  add constraint prediction_markets_winning_answer_fk
  foreign key (winning_answer_id) references prediction_answers(id);

-- Stakes are immutable: a refund or payout is a ledger row, never an edit here.
create table if not exists prediction_stakes (
  id                    uuid        primary key default gen_random_uuid(),
  chapter_id            uuid        not null references chapters(id) on delete cascade,
  market_id             uuid        not null references prediction_markets(id) on delete cascade,
  answer_id             uuid        not null references prediction_answers(id) on delete cascade,
  user_id               uuid        not null references users(id),
  amount                int         not null check (amount >= 1),
  point_transaction_id  uuid        not null references point_transactions(id),
  client_message_id     uuid        not null,
  created_at            timestamptz not null default now(),
  unique (chapter_id, client_message_id)
);
create index if not exists prediction_stakes_market on prediction_stakes (market_id, created_at);
create index if not exists prediction_stakes_user on prediction_stakes (chapter_id, user_id);
alter table prediction_stakes enable row level security;

create table if not exists prediction_questions (
  id          uuid        primary key default gen_random_uuid(),
  chapter_id  uuid        not null references chapters(id) on delete cascade,
  market_id   uuid        not null references prediction_markets(id) on delete cascade,
  user_id     uuid        not null references users(id),
  note        text        not null check (char_length(note) between 1 and 500),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists prediction_questions_market on prediction_questions (market_id);
alter table prediction_questions enable row level security;

-- RLS on with no policies: like chapter config, these are reached only through
-- the API's service-role client, which applies channel access and blocks.
revoke all on prediction_markets, prediction_answers, prediction_stakes, prediction_questions
  from anon, authenticated;

-- ── place_prediction_stake ──────────────────────────────────────────────────
-- One stake, atomically: the staker's lock first (so two stakes on different
-- markets can't both pass the balance check), then the market row (so two
-- members can't both pass the cap or read a stale pool). Errors are raised with
-- a stable code in the message, which PredictionService maps to HTTP.
create or replace function place_prediction_stake(
  p_chapter_id        uuid,
  p_market_id         uuid,
  p_answer_id         uuid,
  p_user_id           uuid,
  p_amount            int,
  p_client_message_id uuid,
  p_since             timestamptz,
  p_max_stake         int
) returns prediction_stakes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing prediction_stakes;
  v_market   prediction_markets;
  v_on_market int;
  v_balance  bigint;
  v_txn_id   uuid;
  v_stake    prediction_stakes;
begin
  perform pg_advisory_xact_lock(hashtextextended('prediction-stake:' || p_chapter_id || ':' || p_user_id, 0));

  select * into v_existing from prediction_stakes
   where chapter_id = p_chapter_id and client_message_id = p_client_message_id;
  if found then
    if v_existing.market_id = p_market_id and v_existing.answer_id = p_answer_id
       and v_existing.user_id = p_user_id and v_existing.amount = p_amount then
      return v_existing;
    end if;
    raise exception 'prediction.stake.key_reused';
  end if;

  select * into v_market from prediction_markets
   where id = p_market_id and chapter_id = p_chapter_id
   for update;
  if not found then
    raise exception 'prediction.market.not_found';
  end if;
  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception 'prediction.market.not_open';
  end if;
  if not exists (select 1 from prediction_answers where id = p_answer_id and market_id = p_market_id) then
    raise exception 'prediction.answer.not_found';
  end if;

  select coalesce(sum(amount), 0) into v_on_market from prediction_stakes
   where market_id = p_market_id and user_id = p_user_id;
  if v_on_market + p_amount > p_max_stake then
    raise exception 'prediction.stake.over_cap';
  end if;

  select coalesce(sum(amount), 0) into v_balance from point_transactions
   where chapter_id = p_chapter_id and user_id = p_user_id
     and (p_since is null or created_at > p_since);
  if v_balance < p_amount then
    raise exception 'prediction.stake.insufficient_points';
  end if;

  insert into point_transactions (chapter_id, user_id, amount, category, description, metadata)
  values (p_chapter_id, p_user_id, -p_amount, 'PREDICTION', 'Prediction stake',
          jsonb_build_object('market_id', p_market_id, 'answer_id', p_answer_id, 'kind', 'stake'))
  returning id into v_txn_id;

  insert into prediction_stakes (chapter_id, market_id, answer_id, user_id, amount,
                                 point_transaction_id, client_message_id)
  values (p_chapter_id, p_market_id, p_answer_id, p_user_id, p_amount, v_txn_id, p_client_message_id)
  returning * into v_stake;

  return v_stake;
end;
$$;

-- ── Internal: write one round of payouts for a market already locked ────────
-- Stakes made after known_at are refunded; the rest of the pool goes to the
-- winning answer's stakers in proportion, floor first, then one point each to
-- the largest remainders (earliest stake breaks a tie), so the round's rows
-- sum to zero against the stakes. With nobody on the winner, everyone is
-- refunded.
create or replace function prediction_write_payouts(p_market prediction_markets)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total bigint;
  v_win   bigint;
begin
  -- Late stakes: refunded.
  insert into point_transactions (chapter_id, user_id, amount, category, description, metadata)
  select p_market.chapter_id, s.user_id, sum(s.amount), 'PREDICTION', 'Prediction refund',
         jsonb_build_object('market_id', p_market.id, 'kind', 'refund', 'round', p_market.payout_round)
    from prediction_stakes s
   where s.market_id = p_market.id
     and p_market.known_at is not null and s.created_at > p_market.known_at
   group by s.user_id;

  select coalesce(sum(amount), 0) into v_total from prediction_stakes s
   where s.market_id = p_market.id
     and (p_market.known_at is null or s.created_at <= p_market.known_at);
  select coalesce(sum(amount), 0) into v_win from prediction_stakes s
   where s.market_id = p_market.id and s.answer_id = p_market.winning_answer_id
     and (p_market.known_at is null or s.created_at <= p_market.known_at);

  if v_total = 0 then
    return;
  end if;

  if v_win = 0 then
    insert into point_transactions (chapter_id, user_id, amount, category, description, metadata)
    select p_market.chapter_id, s.user_id, sum(s.amount), 'PREDICTION', 'Prediction refund',
           jsonb_build_object('market_id', p_market.id, 'kind', 'refund', 'round', p_market.payout_round)
      from prediction_stakes s
     where s.market_id = p_market.id
       and (p_market.known_at is null or s.created_at <= p_market.known_at)
     group by s.user_id;
    return;
  end if;

  with winners as (
    select s.user_id, sum(s.amount)::bigint as staked, min(s.created_at) as first_at
      from prediction_stakes s
     where s.market_id = p_market.id and s.answer_id = p_market.winning_answer_id
       and (p_market.known_at is null or s.created_at <= p_market.known_at)
     group by s.user_id
  ), shares as (
    select user_id, first_at,
           (staked * v_total) / v_win as base,
           (staked * v_total) % v_win as rem
      from winners
  ), leftover as (
    select v_total - sum(base) as n from shares
  ), ranked as (
    select s.*, row_number() over (order by rem desc, first_at asc, user_id) as rn
      from shares s
  )
  insert into point_transactions (chapter_id, user_id, amount, category, description, metadata)
  select p_market.chapter_id, r.user_id,
         r.base + case when r.rn <= (select n from leftover) then 1 else 0 end,
         'PREDICTION', 'Prediction payout',
         jsonb_build_object('market_id', p_market.id, 'answer_id', p_market.winning_answer_id,
                            'kind', 'payout', 'round', p_market.payout_round)
    from ranked r
   where r.base + case when r.rn <= (select n from leftover) then 1 else 0 end > 0;
end;
$$;

-- ── Internal: reverse the current round's payouts and refunds ───────────────
create or replace function prediction_reverse_round(p_market prediction_markets)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into point_transactions (chapter_id, user_id, amount, category, description, metadata)
  select t.chapter_id, t.user_id, -sum(t.amount), 'PREDICTION', 'Prediction correction',
         jsonb_build_object('market_id', p_market.id, 'kind', 'correction', 'round', p_market.payout_round)
    from point_transactions t
   where t.chapter_id = p_market.chapter_id
     and t.category = 'PREDICTION'
     and t.metadata->>'market_id' = p_market.id::text
     and t.metadata->>'kind' in ('payout', 'refund')
     and (t.metadata->>'round')::int = p_market.payout_round
   group by t.chapter_id, t.user_id
  having sum(t.amount) <> 0;
end;
$$;

-- ── pay_prediction_market ───────────────────────────────────────────────────
-- Pays a market that is settled (or questioned and now confirmed), or re-pays
-- a paid one whose winner changed: the old round is reversed first. Sets the
-- winning answer when p_answer_id is given.
create or replace function pay_prediction_market(
  p_chapter_id uuid,
  p_market_id  uuid,
  p_answer_id  uuid,
  -- The payout sweep passes true: a market questioned after the sweep read
  -- it waits for an officer instead of paying.
  p_unquestioned_only boolean default false
) returns prediction_markets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market prediction_markets;
begin
  select * into v_market from prediction_markets
   where id = p_market_id and chapter_id = p_chapter_id
   for update;
  if not found then
    raise exception 'prediction.market.not_found';
  end if;
  if v_market.status not in ('settled', 'questioned', 'paid') then
    raise exception 'prediction.market.not_settled';
  end if;
  if p_unquestioned_only and v_market.status = 'questioned' then
    raise exception 'prediction.market.questioned';
  end if;
  if p_answer_id is not null then
    if not exists (select 1 from prediction_answers where id = p_answer_id and market_id = p_market_id) then
      raise exception 'prediction.answer.not_found';
    end if;
  end if;

  if v_market.status = 'paid' then
    if p_answer_id is null or p_answer_id = v_market.winning_answer_id then
      return v_market;
    end if;
    perform prediction_reverse_round(v_market);
    v_market.payout_round := v_market.payout_round + 1;
  end if;

  v_market.winning_answer_id := coalesce(p_answer_id, v_market.winning_answer_id);
  perform prediction_write_payouts(v_market);

  update prediction_questions set resolved_at = now()
   where market_id = p_market_id and resolved_at is null;

  update prediction_markets
     set status = 'paid', paid_at = now(),
         winning_answer_id = v_market.winning_answer_id,
         payout_round = v_market.payout_round
   where id = p_market_id
  returning * into v_market;
  return v_market;
end;
$$;

-- ── void_prediction_market ──────────────────────────────────────────────────
-- Refunds every stake. A paid market's round is reversed first, so each
-- staker ends at exactly what they had before staking.
create or replace function void_prediction_market(
  p_chapter_id uuid,
  p_market_id  uuid,
  p_by         uuid,
  -- The settler voids only before payout; under this lock, a market the
  -- sweep paid a moment ago is refused rather than reversed.
  p_before_payout_only boolean default false
) returns prediction_markets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market prediction_markets;
begin
  select * into v_market from prediction_markets
   where id = p_market_id and chapter_id = p_chapter_id
   for update;
  if not found then
    raise exception 'prediction.market.not_found';
  end if;
  if v_market.status = 'voided' then
    raise exception 'prediction.market.voided';
  end if;
  if p_before_payout_only and v_market.status = 'paid' then
    raise exception 'prediction.market.paid';
  end if;

  if v_market.status = 'paid' then
    perform prediction_reverse_round(v_market);
    v_market.payout_round := v_market.payout_round + 1;
  end if;

  insert into point_transactions (chapter_id, user_id, amount, category, description, metadata)
  select v_market.chapter_id, s.user_id, sum(s.amount), 'PREDICTION', 'Prediction refund',
         jsonb_build_object('market_id', v_market.id, 'kind', 'void_refund')
    from prediction_stakes s
   where s.market_id = v_market.id
   group by s.user_id;

  update prediction_questions set resolved_at = now()
   where market_id = p_market_id and resolved_at is null;

  update prediction_markets
     set status = 'voided', voided_at = now(), voided_by = p_by,
         payout_round = v_market.payout_round
   where id = p_market_id
  returning * into v_market;
  return v_market;
end;
$$;

revoke all on function place_prediction_stake(uuid, uuid, uuid, uuid, int, uuid, timestamptz, int) from public, anon, authenticated;
revoke all on function prediction_write_payouts(prediction_markets) from public, anon, authenticated;
revoke all on function prediction_reverse_round(prediction_markets) from public, anon, authenticated;
revoke all on function pay_prediction_market(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function void_prediction_market(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- ── A deleted channel voids what it holds ───────────────────────────────────
-- Markets cascade away with their channel, but the ledger rows of their stakes
-- don't. So before a channel goes, every market in it that hasn't paid or
-- voided is voided, which refunds its stakes; a paid market's rows already net
-- out. Covers every path that deletes a channel (Delete channel, the Discord
-- import purge).
create or replace function prediction_void_channel_markets()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A whole chapter being deleted takes its ledger with it: nothing to refund,
  -- and a refund row would point at a chapter that is already gone.
  if not exists (select 1 from chapters where id = old.chapter_id) then
    return old;
  end if;
  for v_id in
    select id from prediction_markets
     where channel_id = old.id and status not in ('paid', 'voided')
  loop
    perform void_prediction_market(old.chapter_id, v_id, null);
  end loop;
  return old;
end;
$$;
revoke all on function prediction_void_channel_markets() from public, anon, authenticated;

drop trigger if exists chat_channels_void_predictions on chat_channels;
create trigger chat_channels_void_predictions
  before delete on chat_channels
  for each row execute function prediction_void_channel_markets();

-- ── Permissions for existing chapters ───────────────────────────────────────
-- predictions:create goes wherever polls:create already is (every member tier
-- by default, #3709); predictions:manage to tiers that manage chapter config
-- (the top tier). New chapters get the same from STARTING_ROLE_TIERS.
update public.role_tiers
   set permissions = permissions || array['predictions:create']
 where permissions @> array['polls:create']
   and not (permissions @> array['predictions:create']);

update public.role_tiers
   set permissions = permissions || array['predictions:manage']
 where permissions @> array['chapter-config:manage']
   and not (permissions @> array['predictions:manage']);

-- After the tiers: a role holding the source key on its own (outside the
-- tiers, or switched on for that role alone) gets the new key the same way,
-- as 20261113040007_chapter_groups.sql did for groups:manage. A role that
-- already switched the new key off keeps that.
update public.roles
   set permission_overrides =
         permission_overrides || jsonb_build_object('predictions:create', true)
 where permissions @> array['polls:create']
   and not ('*' = any (permissions))
   and not ('predictions:create' = any (permissions))
   and not (permission_overrides ? 'predictions:create');

update public.roles
   set permission_overrides =
         permission_overrides || jsonb_build_object('predictions:manage', true)
 where permissions @> array['chapter-config:manage']
   and not ('*' = any (permissions))
   and not ('predictions:manage' = any (permissions))
   and not (permission_overrides ? 'predictions:manage');
