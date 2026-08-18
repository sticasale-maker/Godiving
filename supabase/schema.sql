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

-- ── Realtime ─────────────────────────────────────────────────────
-- Wrapped because adding a table that is already published errors.
do $$
begin
  alter publication supabase_realtime add table public.scores;
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
