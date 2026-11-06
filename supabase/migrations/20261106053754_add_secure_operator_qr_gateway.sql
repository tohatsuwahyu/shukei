
alter table public.operators
  add column qr_token_hash text;

alter table public.work_sessions
  alter column created_by drop not null;

create unique index work_sessions_one_running_operator_idx
  on public.work_sessions (operator_id)
  where status = 'running';

create or replace function public.operator_start(p_part_code text, p_operator_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_part public.parts%rowtype;
  v_process_id uuid;
  v_session_id uuid;
begin
  select * into v_part
  from public.parts
  where upper(code) = upper(p_part_code)
  for update;

  if not found then raise exception 'PART_NOT_FOUND'; end if;
  if v_part.status = 'completed' then raise exception 'PART_COMPLETED'; end if;
  if jsonb_array_length(v_part.route) <= v_part.current_step then raise exception 'ROUTE_FINISHED'; end if;

  v_process_id := (v_part.route ->> v_part.current_step)::uuid;
  if not exists (select 1 from public.processes where id = v_process_id and active = true) then
    raise exception 'PROCESS_NOT_FOUND';
  end if;

  if exists (select 1 from public.work_sessions where operator_id = p_operator_id and status = 'running') then
    raise exception 'OPERATOR_ALREADY_RUNNING';
  end if;

  insert into public.work_sessions(part_id, operator_id, process_id, status, started_at, created_by)
  values (v_part.id, p_operator_id, v_process_id, 'running', now(), null)
  returning id into v_session_id;

  insert into public.work_segments(session_id, segment_type, started_at)
  values (v_session_id, 'work', now());

  insert into public.work_events(session_id, event_type, occurred_at)
  values (v_session_id, 'START', now());

  update public.parts set status = 'in_progress' where id = v_part.id;
  return v_session_id;
end;
$$;

create or replace function public.operator_close(
  p_part_code text,
  p_operator_id uuid,
  p_result text,
  p_event_type text,
  p_note text default ''
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

  select * into v_part
  from public.parts
  where upper(code) = upper(p_part_code)
  for update;

  if not found then raise exception 'PART_NOT_FOUND'; end if;

  select * into v_session
  from public.work_sessions
  where part_id = v_part.id and operator_id = p_operator_id and status = 'running'
  order by started_at desc
  limit 1
  for update;

  if not found then raise exception 'NO_RUNNING_SESSION'; end if;

  select exists (
    select 1 from public.work_sessions
    where part_id = v_part.id
      and process_id = v_session.process_id
      and status = 'running'
      and id <> v_session.id
  ) into v_other_running;

  if p_result = 'complete' and v_other_running then
    raise exception 'OTHER_OPERATOR_RUNNING';
  end if;

  update public.work_segments
  set ended_at = now()
  where session_id = v_session.id and ended_at is null;

  update public.work_sessions
  set status = 'stopped', ended_at = now()
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

revoke all on function public.operator_start(text, uuid) from public, anon, authenticated;
revoke all on function public.operator_close(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.operator_start(text, uuid) to service_role;
grant execute on function public.operator_close(text, uuid, text, text, text) to service_role;
