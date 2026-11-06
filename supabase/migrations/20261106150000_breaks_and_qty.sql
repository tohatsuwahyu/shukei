-- 休憩時間の設定 / 良品・NG数量 / 終業時の自動中断
-- Supabase の SQL Editor に貼り付けて「Run」してください（何度実行しても安全です）。

-- 1) 設定テーブル（休憩時間を管理者が変更できる）
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings for select to authenticated using (true);

drop policy if exists "settings_write" on public.app_settings;
create policy "settings_write" on public.app_settings for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

insert into public.app_settings(key, value)
values ('breaks', '[{"start":"10:00","end":"10:10"},{"start":"12:00","end":"12:45"},{"start":"15:00","end":"15:10"}]'::jsonb)
on conflict (key) do nothing;

-- 2) 良品・NG数量
alter table public.work_sessions add column if not exists qty_good numeric(12,2) check (qty_good is null or qty_good >= 0);
alter table public.work_sessions add column if not exists qty_ng   numeric(12,2) check (qty_ng   is null or qty_ng   >= 0);

-- 3) operator_close を数量付きで作り直す
drop function if exists public.operator_close(text, uuid, text, text, text);
create or replace function public.operator_close(
  p_part_code text,
  p_operator_id uuid,
  p_result text,
  p_event_type text,
  p_note text default '',
  p_qty_good numeric default null,
  p_qty_ng numeric default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_part public.parts%rowtype;
  v_session public.work_sessions%rowtype;
  v_next_step integer;
  v_other_running boolean;
begin
  if p_result not in ('complete', 'pause') then raise exception 'INVALID_RESULT'; end if;
  if p_event_type not in ('STOP', 'HOLD_MATERIAL', 'HOLD_MACHINE', 'URGENT_SWITCH', 'NG') then
    raise exception 'INVALID_EVENT';
  end if;
  if coalesce(p_qty_good, 0) < 0 or coalesce(p_qty_ng, 0) < 0 then raise exception 'INVALID_QTY'; end if;

  select * into v_part from public.parts where upper(code) = upper(p_part_code) for update;
  if not found then raise exception 'PART_NOT_FOUND'; end if;

  select * into v_session from public.work_sessions
  where part_id = v_part.id and operator_id = p_operator_id and status = 'running'
  order by started_at desc limit 1 for update;
  if not found then raise exception 'NO_RUNNING_SESSION'; end if;

  select exists (
    select 1 from public.work_sessions
    where part_id = v_part.id and process_id = v_session.process_id
      and status = 'running' and id <> v_session.id
  ) into v_other_running;

  if p_result = 'complete' and v_other_running then raise exception 'OTHER_OPERATOR_RUNNING'; end if;

  update public.work_segments set ended_at = now() where session_id = v_session.id and ended_at is null;

  update public.work_sessions
  set status = 'stopped', ended_at = now(), qty_good = p_qty_good, qty_ng = p_qty_ng
  where id = v_session.id;

  insert into public.work_events(session_id, event_type, occurred_at, note)
  values (v_session.id, p_event_type, now(), coalesce(p_note, ''));

  if p_result = 'complete' then
    v_next_step := v_part.current_step + 1;
    update public.parts
    set current_step = v_next_step,
        status = case when v_next_step >= jsonb_array_length(v_part.route) then 'completed' else 'ready' end
    where id = v_part.id;
  else
    update public.parts
    set status = case when v_other_running then 'in_progress' else 'paused' end
    where id = v_part.id;
  end if;
end;
$$;
revoke all on function public.operator_close(text, uuid, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.operator_close(text, uuid, text, text, text, numeric, numeric) to service_role;

-- 4) 終業時に作業中のものをまとめて中断する（pg_cron から呼ぶ。手動実行も可）
create or replace function public.auto_pause_running(p_note text default '終業時刻の自動中断')
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select id from public.work_sessions where status = 'running' loop
    perform public.admin_close_session(r.id, now(), p_note);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.auto_pause_running(text) from public, anon, authenticated;
grant execute on function public.auto_pause_running(text) to service_role;
