-- 作業時間集計システム: Supabase SQL Editor で一度だけ実行するSQL
-- 重要: このアプリのブラウザ側には publishable key だけを使う。
-- service_role / secret key をGitHubやHTMLに貼り付けないこと。

create extension if not exists pgcrypto;
create schema if not exists app_private;

do $$ begin
  create type public.app_role as enum ('operator', 'manager', 'admin');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'operator',
  created_at timestamptz not null default now()
);

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  name text not null,
  standard_minutes numeric(10,2) check (standard_minutes >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 管理者が作成する生産計画のPart管理単位。QRはこのcodeに発行する。
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  plan_no text not null,
  part_no text not null,
  name text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  route jsonb not null default '[]'::jsonb,
  current_step integer not null default 0 check (current_step >= 0),
  status text not null default 'ready' check (status in ('ready', 'in_progress', 'paused', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  part_id uuid references public.parts(id),
  operator_id uuid not null references public.operators(id),
  process_id uuid not null references public.processes(id),
  status text not null default 'running' check (status in ('running', 'paused', 'stopped')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

alter table public.work_sessions add column if not exists part_id uuid references public.parts(id);

create table if not exists public.work_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  segment_type text not null default 'work' check (segment_type in ('work')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('START', 'STOP', 'RESUME', 'HOLD_MATERIAL', 'HOLD_MACHINE', 'URGENT_SWITCH', 'NG')),
  occurred_at timestamptz not null default now(),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists work_sessions_started_at_idx on public.work_sessions (started_at desc);
create index if not exists work_sessions_operator_idx on public.work_sessions (operator_id, started_at desc);
create index if not exists work_sessions_process_idx on public.work_sessions (process_id, started_at desc);
create index if not exists parts_status_idx on public.parts (status, created_at desc);
create index if not exists work_segments_session_idx on public.work_segments (session_id, started_at);
create index if not exists work_events_session_idx on public.work_events (session_id, occurred_at desc);

-- 新規Authユーザーに必ずoperatorプロフィールを作る
create or replace function app_private.make_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function app_private.make_profile() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure app_private.make_profile();

-- RLS内から現在ログイン中のroleを安全に読む（入力値を受け取らない）
create or replace function app_private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function app_private.current_app_role() from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.current_app_role() to authenticated;

-- Data APIの権限を明示。anon（未ログイン）には一切付与しない。
revoke all on all tables in schema public from anon;
revoke all on public.profiles, public.operators, public.processes, public.parts, public.work_sessions, public.work_segments, public.work_events from authenticated;
grant select on public.profiles, public.operators, public.processes, public.parts to authenticated;
grant insert, update on public.operators, public.processes, public.parts to authenticated;
grant select, insert, update on public.work_sessions, public.work_segments to authenticated;
grant select, insert on public.work_events to authenticated;

alter table public.profiles enable row level security;
alter table public.operators enable row level security;
alter table public.processes enable row level security;
alter table public.parts enable row level security;
alter table public.work_sessions enable row level security;
alter table public.work_segments enable row level security;
alter table public.work_events enable row level security;

drop policy if exists "profile_self_read" on public.profiles;
create policy "profile_self_read" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select app_private.current_app_role()) in ('manager', 'admin'));

drop policy if exists "operator_read" on public.operators;
drop policy if exists "operator_admin_write" on public.operators;
create policy "operator_read" on public.operators for select to authenticated using (true);
create policy "operator_admin_write" on public.operators for all to authenticated
using ((select app_private.current_app_role()) = 'admin')
with check ((select app_private.current_app_role()) = 'admin');

drop policy if exists "process_read" on public.processes;
drop policy if exists "process_admin_write" on public.processes;
create policy "process_read" on public.processes for select to authenticated using (true);
create policy "process_admin_write" on public.processes for all to authenticated
using ((select app_private.current_app_role()) = 'admin')
with check ((select app_private.current_app_role()) = 'admin');

drop policy if exists "part_read" on public.parts;
drop policy if exists "part_admin_write" on public.parts;
create policy "part_read" on public.parts for select to authenticated using (true);
create policy "part_admin_write" on public.parts for all to authenticated
using ((select app_private.current_app_role()) in ('manager', 'admin'))
with check ((select app_private.current_app_role()) in ('manager', 'admin'));

drop policy if exists "session_read" on public.work_sessions;
drop policy if exists "session_insert" on public.work_sessions;
drop policy if exists "session_update" on public.work_sessions;
create policy "session_read" on public.work_sessions for select to authenticated
using (created_by = (select auth.uid()) or (select app_private.current_app_role()) in ('manager', 'admin'));
create policy "session_insert" on public.work_sessions for insert to authenticated
with check (created_by = (select auth.uid()));
create policy "session_update" on public.work_sessions for update to authenticated
using (created_by = (select auth.uid()) or (select app_private.current_app_role()) in ('manager', 'admin'))
with check (created_by = (select auth.uid()) or (select app_private.current_app_role()) in ('manager', 'admin'));

drop policy if exists "segment_read" on public.work_segments;
drop policy if exists "segment_insert" on public.work_segments;
drop policy if exists "segment_update" on public.work_segments;
create policy "segment_read" on public.work_segments for select to authenticated
using (exists (select 1 from public.work_sessions s where s.id = session_id));
create policy "segment_insert" on public.work_segments for insert to authenticated
with check (exists (select 1 from public.work_sessions s where s.id = session_id));
create policy "segment_update" on public.work_segments for update to authenticated
using (exists (select 1 from public.work_sessions s where s.id = session_id))
with check (exists (select 1 from public.work_sessions s where s.id = session_id));

drop policy if exists "event_read" on public.work_events;
drop policy if exists "event_insert" on public.work_events;
create policy "event_read" on public.work_events for select to authenticated
using (exists (select 1 from public.work_sessions s where s.id = session_id));
create policy "event_insert" on public.work_events for insert to authenticated
with check (exists (select 1 from public.work_sessions s where s.id = session_id));

-- マスタはAdmin画面で会社の実データを登録する。ダミーの作業者・工程は作成しない。
-- 管理者アカウント作成後、メールアドレスを入れて一度実行:
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'admin@example.com');


-- 現品票（生産計画）情報の追加
-- Applied to the production database as migration: add_genpinhyo_fields_to_parts
alter table public.parts
  add column if not exists customer text not null default '',
  add column if not exists model text not null default '',
  add column if not exists product_no text not null default '',
  add column if not exists order_no text not null default '',
  add column if not exists lot_no text not null default '',
  add column if not exists due_date date,
  add column if not exists note text not null default '';

comment on column public.parts.plan_no is '製番または生産計画No.';
comment on column public.parts.customer is '得意先';
comment on column public.parts.model is '機種';
comment on column public.parts.product_no is '品番';
comment on column public.parts.part_no is '図番';
comment on column public.parts.name is '品名';
comment on column public.parts.order_no is '受注No.';
comment on column public.parts.lot_no is 'ロットNo.';
comment on column public.parts.due_date is '納期';
comment on column public.parts.note is '備考';
