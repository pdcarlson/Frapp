-- A member's birthday on their profile (#4959, 2026-11-14).
--
-- Shawn asked for it: "have someone in the profile fill out the birthday, and
-- then it shows up on the calendar, and then an automatic message". Month and
-- day, with an optional year that is never shown to anyone else (Facebook
-- shows the year only to the people the member picks; Frapp shows it to no
-- one). A birthday belongs to the person, not the membership, so it sits on
-- `users` beside `phone` and `major`, and one choice covers every chapter
-- they are in.
--
-- `birthday_visibility` is who may see it: 'nobody' (the default, so nothing
-- a member typed before choosing is ever shown) or 'chapter' (members of
-- their chapters see it on the profile and the calendar, and the chapter's
-- birthday post can name them). Only the member sets any of it
-- (`PATCH /v1/users/me`).
--
-- RLS on `users` gives signed-in members no read policy (its one policy,
-- `auth_admin_can_read_users`, is for the auth hook), so the columns are read
-- only through the API, which applies the visibility.
alter table public.users
  add column if not exists birthday_month smallint,
  add column if not exists birthday_day smallint,
  add column if not exists birthday_year smallint,
  add column if not exists birthday_visibility text not null default 'nobody';

-- Month and day come together; a year needs both. The day must exist in the
-- month (29 February is allowed, since the year is optional: a leap-day
-- birthday is celebrated on 28 February in other years). The year range is a
-- backstop at the API's own (`BIRTH_YEAR_MIN` in `@repo/validation`).
alter table public.users
  drop constraint if exists users_birthday_valid;
alter table public.users
  add constraint users_birthday_valid
  check (
    (birthday_month is null and birthday_day is null and birthday_year is null)
    or (
      birthday_month between 1 and 12
      and birthday_day between 1 and (
        case
          when birthday_month = 2 then 29
          when birthday_month in (4, 6, 9, 11) then 30
          else 31
        end
      )
      and (
        birthday_year is null
        or (
          birthday_year between 1900 and 2100
          and not (
            birthday_month = 2 and birthday_day = 29
            and not ((birthday_year % 4 = 0 and birthday_year % 100 <> 0)
                     or birthday_year % 400 = 0)
          )
        )
      )
    )
  ) not valid;
alter table public.users validate constraint users_birthday_valid;

alter table public.users
  drop constraint if exists users_birthday_visibility_valid;
alter table public.users
  add constraint users_birthday_visibility_valid
  check (birthday_visibility in ('chapter', 'nobody')) not valid;
alter table public.users validate constraint users_birthday_visibility_valid;

-- Account deletion clears it. `anonymize_user` stamps `deleted_at` on the row;
-- this trigger clears the birthday on any write to a tombstoned row, so the
-- scrub covers it without redefining that function again (every redefinition
-- of it is a merge conflict with every other), and a retried deletion clears
-- it too.
create or replace function public.users_clear_birthday_on_tombstone()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is not null then
    new.birthday_month := null;
    new.birthday_day := null;
    new.birthday_year := null;
    new.birthday_visibility := 'nobody';
  end if;
  return new;
end;
$$;

drop trigger if exists users_clear_birthday_on_tombstone on public.users;
create trigger users_clear_birthday_on_tombstone
  before insert or update on public.users
  for each row
  execute function public.users_clear_birthday_on_tombstone();

-- A trigger needs no grant, and must not be callable as an RPC (#830).
revoke execute on function public.users_clear_birthday_on_tombstone()
  from public, anon, authenticated;
