-- ════════════════════════════════════════════════════════════════
-- Godiving arcade — Supabase schema
-- Run in: Supabase dashboard -> SQL editor -> New query -> Run
--
-- Safe to run more than once (everything is IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════

-- ── Base table (already exists on the live project; here for reference
--    and so a fresh project can be stood up from scratch) ───────────
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  name text, score int, grp text,
  device text, station text,
  ts timestamptz default now()
);

-- ── Prize / ticket columns ───────────────────────────────────────
-- code       the ticket code printed on screen and encoded in the QR
-- exp        experience axis: none | snorkel | scuba | freedive
-- age        kept for admin reporting; grp is what the draw uses
-- claimed_at set by staff when a compass is physically handed over
-- golden     true if this session hit a Golden Compass instant win
-- hidden     soft delete, replaces the old destructive anon delete
alter table public.scores add column if not exists code       text;
alter table public.scores add column if not exists exp        text;
alter table public.scores add column if not exists age        int;
alter table public.scores add column if not exists claimed_at timestamptz;
alter table public.scores add column if not exists golden     boolean default false;
alter table public.scores add column if not exists hidden     boolean default false;

create unique index if not exists scores_code_idx on public.scores (code);
create index if not exists scores_ts_idx   on public.scores (ts);
create index if not exists scores_grp_idx  on public.scores (grp);

-- ── Bound the damage from a forged insert ────────────────────────
-- The anon key is public by design (it ships in arcade.html, which is
-- in a public repo), so anyone can insert a row. These constraints
-- mean the worst case is a plausible fake score rather than a
-- 999,999 that silently owns every draw for the whole weekend.
--
-- NOTE: raise the ceiling if the new games push the real maximum up.
-- Check the top honest score after a full playthrough and leave
-- generous headroom.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scores_score_sane') then
    alter table public.scores add constraint scores_score_sane
      check (score >= 0 and score <= 3000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scores_name_sane') then
    alter table public.scores add constraint scores_name_sane
      check (char_length(coalesce(name, '')) <= 20);
  end if;
end $$;

-- ── Row level security ───────────────────────────────────────────
alter table public.scores enable row level security;

drop policy if exists "anon read"   on public.scores;
drop policy if exists "anon insert" on public.scores;
drop policy if exists "anon update" on public.scores;

create policy "anon read"   on public.scores for select using (true);
create policy "anon insert" on public.scores for insert with check (true);
create policy "anon update" on public.scores for update using (true) with check (true);

-- ⚠ THE IMPORTANT ONE ⚠
-- The previous schema granted anonymous DELETE on scores. Anyone who
-- viewed source could wipe the entire leaderboard mid-show, and the
-- leaderboard now decides who gets a physical prize. Remove it.
drop policy if exists "anon delete" on public.scores;
revoke delete on public.scores from anon;

-- Anonymous clients may only ever write these two columns. The admin
-- console runs on the same anon key, so this is what lets staff mark a
-- compass claimed without also handing every visitor the ability to
-- rewrite scores.
--   claimed_at -> staff marking a handover at the stand
--   hidden     -> soft delete, replaces the destructive DELETE above
revoke update on public.scores from anon;
grant  update (claimed_at, hidden) on public.scores to anon;

-- ── Shared draw settings ─────────────────────────────────────────
-- Winners are computed independently on every device, so every device
-- MUST agree on the rules. If staff drop winners_per_group from 2 to 1
-- because stock is running low, a ticket page still using 2 would tell
-- someone they won a compass that was never allocated. Config lives
-- here, not in localStorage, for exactly that reason.
create table if not exists public.settings (
  id                     int primary key default 1,
  winners_per_group      int default 3,
  stock                  int default 120,
  reserve_for_instant    int default 45,
  max_per_player_per_day int default 1,
  updated_at             timestamptz default now(),
  constraint settings_single_row check (id = 1)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

alter table public.settings enable row level security;
drop policy if exists "anon read settings"   on public.settings;
drop policy if exists "anon update settings" on public.settings;
create policy "anon read settings"   on public.settings for select using (true);
create policy "anon update settings" on public.settings for update using (true) with check (true);
revoke delete, insert on public.settings from anon;

-- ── Realtime ─────────────────────────────────────────────────────
-- Wrapped because adding a table that is already published errors.
do $$
begin
  alter publication supabase_realtime add table public.scores;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.settings;
exception
  when duplicate_object then null;
end $$;

-- ── Sanity check ─────────────────────────────────────────────────
-- Expect: anon has SELECT, INSERT, and UPDATE on (claimed_at, hidden)
-- only, and no DELETE.
select privilege_type, column_name
from information_schema.column_privileges
where table_name = 'scores' and grantee = 'anon'
order by privilege_type, column_name;

-- ── Shared game availability (added after the 2026 rehearsals) ────
-- Which games are offered to which age group, and to which kind of
-- diver, used to live in localStorage. That meant the laptop an
-- operator configured and the machines people actually played on
-- disagreed: a game switched off for adults kept appearing, because
-- "off" had only ever been recorded on one browser. It belongs in the
-- same shared row as the prize rules, for the same reason.
alter table public.settings add column if not exists game_age_groups jsonb;
alter table public.settings add column if not exists game_exp        jsonb;

-- The two columns above narrow a game to some players. Neither takes a game
-- off the stand: to do that an operator had to untick every box on the row,
-- which reads as a half-finished edit rather than a decision. These carry the
-- list itself — an explicit on/off per game, and the running order the menu
-- and the strip share — and they are shared for the same reason as the rest.
alter table public.settings add column if not exists games_enabled   jsonb;
alter table public.settings add column if not exists game_order      jsonb;

-- ── Rehearsal ────────────────────────────────────────────────────
-- The prize flow only happens on the two show days, which leaves it
-- untestable for the months beforehand. Rehearsal mode replaces the
-- hourly freeze with short slots so the whole path can be run through
-- in minutes.
--   { "on": true, "minutes": 5, "started": 1756339200000 }
-- "started" is an absolute epoch anchor and is the reason this is a
-- shared column rather than a URL flag: the old per-device test mode
-- started counting when each browser switched it on, so a booth laptop
-- and the phone that scanned its QR were on different schedules, and
-- the handoff between them was the one thing worth rehearsing.
alter table public.settings add column if not exists rehearsal       jsonb;

-- ── Consolation compass ──────────────────────────────────────────
-- Every player takes a little compass home, not just the podium. There are a
-- fixed number of them and no way to know in advance how many people will
-- play, so this is a switch: when the box is empty staff turn it off and all
-- four screens stop promising one in the same moment.
-- Absent or true means on, so the promise works before this line is run.
alter table public.settings add column if not exists consolation_on boolean default true;
