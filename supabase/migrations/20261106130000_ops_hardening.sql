-- 運用強化: ブラウザから作業記録を直接書けないようにし、終了忘れの強制終了RPCを追加する。
-- 実行順: このファイルを Supabase SQL Editor で実行 → Edge Function operator-gateway を再デプロイ。

-- 1) 作業記録の書き込みは Edge Function(service_role) 経由のみ。
--    現場端末アカウントでもブラウザのコンソールから時刻を改ざんできなくなる。
revoke insert, update on public.work_sessions, public.work_segments from authenticated;
revoke insert on public.work_events from authenticated;
drop policy if exists "session_insert" on public.work_sessions;
drop policy if exists "session_update" on public.work_sessions;
drop policy if exists "segment_insert" on public.work_segments;
drop policy if exists "segment_update" on public.work_segments;
drop policy if exists "event_insert" on public.work_events;

-- 2) 作業者QRトークンのハッシュをブラウザから読めないようにする（列単位で許可）。
revoke select on public.operators from authenticated;
grant select (id, code, name, active, created_at) on public.operators to authenticated;

-- 3) スキャナが読める形式のコードだけ登録可（既存行は検証しない）。
do $$ begin
  alter table public.parts add constraint parts_code_format check (code ~ '^[A-Z0-9._/-]{1,80}$') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.operators add constraint operators_code_format check (code ~ '^[A-Z0-9._-]{2,40}$') not valid;
exception when duplicate_object then null; end $$;

-- 4) 集計の高速化
create index if not exists work_sessions_part_idx on public.work_sessions (part_id, started_at desc);
create index if not exists work_sessions_running_idx on public.work_sessions (started_at) where status = 'running';

-- 5) 終了忘れの作業を、指定した終了時刻で締める（管理者・生産管理が実績画面から実行）
create or replace function public.admin_close_session(p_session_id uuid, p_ended_at timestamptz default null, p_note text default '')
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.work_sessions%rowtype;
  v_end timestamptz;
  v_other boolean;
begin
  select * into v_session from public.work_sessions
  where id = p_session_id and status = 'running' for update;
  if not found then raise exception 'NO_RUNNING_SESSION'; end if;

  v_end := least(coalesce(p_ended_at, now()), now());
  if v_end < v_session.started_at then raise exception 'INVALID_END_TIME'; end if;

  update public.work_segments set ended_at = v_end where session_id = v_session.id and ended_at is null;
  update public.work_sessions set status = 'stopped', ended_at = v_end where id = v_session.id;
  insert into public.work_events(session_id, event_type, occurred_at, note)
  values (v_session.id, 'STOP', v_end, '管理者による終了' || case when coalesce(p_note, '') = '' then '' else ': ' || p_note end);

  select exists (select 1 from public.work_sessions
                 where part_id = v_session.part_id and status = 'running' and id <> v_session.id) into v_other;
  update public.parts set status = case when v_other then 'in_progress' else 'paused' end
  where id = v_session.part_id and status <> 'completed';
end;
$$;
revoke all on function public.admin_close_session(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_close_session(uuid, timestamptz, text) to service_role;
